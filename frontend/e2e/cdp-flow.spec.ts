import { expect } from '@playwright/test';
import { test } from '@playwright/test';
import { createPublicClient, http, type Address } from 'viem';

const ENGINE_READ_ABI = [
  {
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tokenCollateralAddress', type: 'address' },
    ],
    name: 'getCollateralBalanceOfUser',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

test('CDP Flow: Deposit -> Mint -> Burn -> Withdraw', async ({ page }) => {
  test.setTimeout(420000);
  const log = (message: string) => console.log(`[e2e][cdp-flow] ${message}`);

  const metricValue = async (label: string) => {
    const valueText = await page
      .locator(`span:text-is("${label}")`)
      .first()
      .locator('xpath=following-sibling::span[1]')
      .innerText();
    return Number.parseFloat(valueText.replace(/,/g, '').trim());
  };

  const mintAmount = '0.01';
  const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || process.env.SEPOLIA_RPC_URL;
  const userAddress = (process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || process.env.NEXT_PUBLIC_E2E_ADDRESS) as Address | undefined;
  const stableCoinEngineAddress = process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_STABLE_COIN_ENGINE as Address | undefined;
  const wethAddress = process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_WETH as Address | undefined;

  if (!rpcUrl || !userAddress || !stableCoinEngineAddress || !wethAddress) {
    throw new Error('Missing env for contract verification of withdraw flow');
  }

  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  const onchainWethCollateral = async () =>
    publicClient.readContract({
      address: stableCoinEngineAddress,
      abi: ENGINE_READ_ABI,
      functionName: 'getCollateralBalanceOfUser',
      args: [userAddress, wethAddress],
    });

  await test.step('Navigate and verify dashboard loads', async () => {
    log('Opening dashboard');
    await page.goto('/');
    await expect(page.getByText('Collateral Manager')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Debt Manager')).toBeVisible({ timeout: 20000 });
    log('Dashboard ready');
  });

  await test.step('Deposit WETH collateral', async () => {
    log('Starting deposit 0.001 WETH');
    const collateralBeforeDeposit = await metricValue('WETH Collateral');
    await page.getByRole('button', { name: 'Deposit', exact: true }).click();
    await page.getByText('WETH', { exact: true }).first().click();
    await page.getByPlaceholder('0.00').first().fill('0.001');

    const depositButton = page.getByRole('button', { name: 'Deposit WETH' });
    await expect(depositButton).toBeEnabled();
    await depositButton.click();

    await expect(page.getByText(/Transaction completed successfully[!.]/)).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => metricValue('WETH Collateral'), { timeout: 120000 })
      .toBeGreaterThan(collateralBeforeDeposit);
    log('Deposit confirmed');
  });

  await test.step('Mint stablecoin debt', async () => {
    log(`Starting mint ${mintAmount} SC`);
    const debtBeforeMint = await metricValue('SC Debt');
    const mintTab = page.getByRole('button', { name: '+ Mint SC' });
    await mintTab.click();
    await page.getByPlaceholder('0.00').last().fill(mintAmount);

    const mintButton = page.getByRole('button', { name: 'Mint StableCoin' });
    await expect(mintButton).toBeEnabled();
    await mintButton.click();

    await expect(page.getByText('Success', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => metricValue('SC Debt'), { timeout: 120000 })
      .toBeGreaterThan(debtBeforeMint);
    await expect(page.getByText('Health Factor', { exact: true })).toBeVisible();
    log('Mint confirmed');
  });

  await test.step('Burn stablecoin debt', async () => {
    log('Starting burn with MAX balance');
    const debtBeforeBurn = await metricValue('SC Debt');
    const burnTab = page.getByRole('button', { name: '- Burn SC' });
    await burnTab.click();

    const burnMaxButton = page.getByRole('button', { name: /^MAX:/ });
    await burnMaxButton.click();

    const burnButton = page.getByRole('button', { name: 'Burn StableCoin' });
    await expect(burnButton).toBeEnabled({ timeout: 30000 });
    await burnButton.click();

    await expect(page.getByText('Success', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => metricValue('SC Debt'), { timeout: 120000 })
      .toBeLessThanOrEqual(debtBeforeBurn);
    log('Burn confirmed');
  });

  await test.step('Withdraw WETH and verify on-chain redeemCollateral effect', async () => {
    log('Starting withdraw 0.001 WETH');
    const onchainCollateralBeforeWithdraw = await onchainWethCollateral();
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await page.getByText('WETH', { exact: true }).first().click();
    await page.getByPlaceholder('0.00').first().fill('0.001');

    const withdrawButton = page.getByRole('button', { name: 'Withdraw WETH' });
    await expect(withdrawButton).toBeEnabled();
    await withdrawButton.click();

    await expect(page.getByText(/Transaction completed successfully[!.]/)).toBeVisible({ timeout: 120000 });
    await expect
      .poll(async () => onchainWethCollateral(), { timeout: 120000 })
      .toBeLessThan(onchainCollateralBeforeWithdraw);
    log('Withdraw confirmed and on-chain collateral decreased');
  });
});
