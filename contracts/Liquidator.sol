// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

/**
 * Aave V3 Liquidator — Flash Loan Executor
 *
 * Workflow:
 *   1. Bot calls executeLiquidation() with user/debt/collateral details
 *   2. Contract borrows debtToken via Aave V3 flashLoanSimple (0.05% fee)
 *   3. In executeOperation callback:
 *      a. Approve Aave Pool to pull debtToken
 *      b. Call pool.liquidationCall() — receives collateral at discount
 *      c. Swap received collateral → debtToken via Uniswap V3
 *      d. Approve Aave Pool to repay flash loan + premium
 *   4. Profit (leftover collateral) stays in this contract
 *   5. Owner can withdraw profit via withdraw()
 *
 * Deployed via Pimlico Smart Account — gasless deployment (no ETH needed).
 * After deploy, this contract address is configured in the Next.js sniper bot
 * via LIQUIDATOR_CONTRACT env var.
 *
 * Required addresses on Base mainnet (chainId 8453):
 *   - Aave V3 PoolAddressesProvider: 0xE20CB4D6D9B11DF15Bd6B07E9B32D6BD4F70BDEe
 *   - Aave V3 Pool: 0x794a313d1f9291A4Ef4a0e9F6c05330513add5d2 (L2Pool)
 *   - Uniswap V3 SwapRouter: 0x2626664c2603336E57bFF023ce8A963F23A1B041
 *
 * Author: Base Sniper Bot
 */

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;

    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    function exactInputSingle(
        ISwapRouter.ExactInputSingleParams calldata params
    ) external returns (uint256 amountOut);
}

contract Liquidator {
    address public owner;
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;
    address public immutable SWAP_ROUTER;
    address public immutable WETH;

    struct LiquidationParams {
        address collateralAsset;
        address user;
        uint24 uniswapFee; // pool fee for collateral → debt swap (typically 3000 = 0.3%)
    }

    constructor(
        address addressesProvider,
        address swapRouter,
        address weth
    ) {
        ADDRESSES_PROVIDER = IPoolAddressesProvider(addressesProvider);
        POOL = IPool(IPoolAddressesProvider(addressesProvider).getPool());
        SWAP_ROUT = swapRouter;
        WETH = weth;
        owner = msg.sender;
    }

    /**
     * Entry point — called by Smart Account via Pimlico UserOp.
     * Initiates flash loan, executes liquidation in callback.
     */
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken,
        uint24 uniswapFee
    ) external {
        require(msg.sender == owner, "Only owner");

        // Encode callback params
        bytes memory params = abi.encode(
            LiquidationParams({
                collateralAsset: collateralAsset,
                user: user,
                uniswapFee: uniswapFee
            })
        );

        // Borrow debtAsset via flash loan
        POOL.flashLoanSimple(address(this), debtAsset, debtToCover, params, 0);
    }

    /**
     * Aave V3 flash loan callback — executes the liquidation.
     * At this point, this contract holds `amount` of `asset` (the debt token).
     */
    function executeOperation(
        address asset, // debt token we borrowed
        uint256 amount,
        uint256 premium, // flash loan fee (0.05%)
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(POOL), "Only Aave Pool can call");

        LiquidationParams memory p = abi.decode(params, (LiquidationParams));

        // 1. Approve Pool to pull the debt token we just borrowed
        IERC20(asset).approve(address(POOL), amount);

        // 2. Liquidate the user — we receive collateral (aTokens if receiveAToken=true, else underlying)
        POOL.liquidationCall(p.collateralAsset, asset, p.user, amount, true);

        // 3. Get received collateral balance
        uint256 collateralReceived = IERC20(p.collateralAsset).balanceOf(address(this));

        // 4. Swap part of collateral back to debt token to repay flash loan
        // Need to repay `amount + premium`
        // Use Uniswap V3 to swap collateral → debt token
        // Swap enough to cover repayment, keep the rest as profit
        IERC20(p.collateralAsset).approve(SWAP_ROUT, collateralReceived);

        ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: p.collateralAsset,
                tokenOut: asset,
                fee: p.uniswapFee,
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: collateralReceived,
                amountOutMinimum: amount + premium, // must cover repayment
                sqrtPriceLimitX96: 0
            });

        uint256 debtReceived = ISwapRouter(SWAP_ROUT).exactInputSingle(swapParams);

        // 5. Approve Pool to repay flash loan + premium
        IERC20(asset).approve(address(POOL), amount + premium);

        // 6. Any remaining debt token is profit — keep in contract
        // Owner can withdraw later via withdraw()

        return true;
    }

    /**
     * Withdraw profit (any leftover tokens in contract).
     */
    function withdraw(address token) external {
        require(msg.sender == owner, "Only owner");
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(owner, bal);
        }
    }

    /**
     * Check potential profit for a liquidation without executing.
     * Returns: collateralToReceive, profit estimate
     */
    function estimateProfit(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover
    ) external view returns (uint256 healthFactor, uint256 liquidationBonus) {
        (, , , uint256 lThreshold, , healthFactor) = POOL.getUserAccountData(user);
        // liquidationBonus is configured per-reserve, typically 5-10%
        // For simplicity, return liquidation threshold as proxy
        liquidationBonus = lThreshold;
    }

    receive() external payable {}
}
