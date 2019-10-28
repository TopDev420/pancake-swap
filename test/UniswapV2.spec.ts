import path from 'path'
import chai from 'chai'
import { solidity, createMockProvider, getWallets, createFixtureLoader } from 'ethereum-waffle'
import { Contract } from 'ethers'
import { BigNumber, bigNumberify } from 'ethers/utils'

import { CHAIN_ID } from './shared/constants'
import { expandTo18Decimals } from './shared/utilities'
import { exchangeFixture, ExchangeFixture } from './shared/fixtures'

chai.use(solidity)
const { expect } = chai

describe('UniswapV2', () => {
  const provider = createMockProvider(path.join(__dirname, '..', 'waffle.json'))
  const [wallet] = getWallets(provider)
  const loadFixture = createFixtureLoader(provider, [wallet])

  let token0: Contract
  let token1: Contract
  let exchange: Contract
  beforeEach(async () => {
    const { token0: _token0, token1: _token1, exchange: _exchange } = (await loadFixture(
      exchangeFixture as any
    )) as ExchangeFixture
    token0 = _token0
    token1 = _token1
    exchange = _exchange
  })

  it('initialize:fail', async () => {
    await expect(exchange.connect(wallet).initialize(token0.address, token1.address, CHAIN_ID)).to.be.revertedWith(
      'UniswapV2: ALREADY_INITIALIZED'
    )
  })

  it('getAmountOutput', async () => {
    const testCases: BigNumber[][] = [
      [1, 5, 10],
      [1, 10, 5],

      [2, 5, 10],
      [2, 10, 5],

      [1, 10, 10],
      [1, 100, 100],
      [1, 1000, 1000]
    ].map(a => a.map((n: number) => expandTo18Decimals(n)))

    const expectedOutputs: BigNumber[] = [
      '1662497915624478906',
      '0453305446940074565',

      '2851015155847869602',
      '0831248957812239453',

      '0906610893880149131',
      '0987158034397061298',
      '0996006981039903216'
    ].map((n: string) => bigNumberify(n))

    const outputs = await Promise.all(testCases.map(a => exchange.getAmountOutput(...a)))

    expect(outputs).to.deep.eq(expectedOutputs)
  })

  it('mintLiquidity', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    const expectedLiquidity = expandTo18Decimals(2)

    await token0.transfer(exchange.address, token0Amount)
    await token1.transfer(exchange.address, token1Amount)
    await expect(exchange.connect(wallet).mintLiquidity(wallet.address))
      .to.emit(exchange, 'LiquidityMinted')
      .withArgs(wallet.address, wallet.address, expectedLiquidity, token0Amount, token1Amount)

    expect(await exchange.totalSupply()).to.eq(expectedLiquidity)
    expect(await exchange.balanceOf(wallet.address)).to.eq(expectedLiquidity)
  })

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(exchange.address, token0Amount)
    await token1.transfer(exchange.address, token1Amount)
    await exchange.connect(wallet).mintLiquidity(wallet.address)
  }

  // it('swap:gas', async () => {
  //   const token0Amount = expandTo18Decimals(5)
  //   const token1Amount = expandTo18Decimals(10)
  //   await addLiquidity(token0Amount, token1Amount)

  //   const swapAmount = expandTo18Decimals(1)
  //   await token0.transfer(exchange.address, swapAmount)
  //   await exchange.connect(wallet).swap(token0.address, wallet.address)

  //   await token0.transfer(exchange.address, swapAmount)
  //   console.log((await exchange.estimate.swap(token0.address, wallet.address)).toString())
  // })

  // it('swap:gas', async () => {
  //   const token0Amount = expandTo18Decimals(10)
  //   const token1Amount = expandTo18Decimals(5)
  //   await addLiquidity(token0Amount, token1Amount)

  //   const swapAmount = expandTo18Decimals(1)
  //   await token1.transfer(exchange.address, swapAmount)
  //   await exchange.connect(wallet).swap(token1.address, wallet.address)

  //   await token1.transfer(exchange.address, swapAmount)
  //   console.log((await exchange.estimate.swap(token1.address, wallet.address)).toString())
  // })

  it('swap', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('1662497915624478906')
    await token0.transfer(exchange.address, swapAmount)
    expect(await exchange.swap)
    await expect(exchange.connect(wallet).swap(token0.address, wallet.address))
      .to.emit(exchange, 'Swap')
      .withArgs(wallet.address, wallet.address, token0.address, swapAmount, expectedOutputAmount)

    expect(await token0.balanceOf(exchange.address)).to.eq(token0Amount.add(swapAmount))
    expect(await token1.balanceOf(exchange.address)).to.eq(token1Amount.sub(expectedOutputAmount))

    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))
  })

  it('burnLiquidity', async () => {
    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    const liquidity = expandTo18Decimals(3)
    await exchange.connect(wallet).transfer(exchange.address, liquidity)
    await expect(exchange.connect(wallet).burnLiquidity(wallet.address))
      .to.emit(exchange, 'LiquidityBurned')
      .withArgs(wallet.address, wallet.address, liquidity, token0Amount, token1Amount)

    expect(await exchange.balanceOf(wallet.address)).to.eq(0)
    expect(await token0.balanceOf(exchange.address)).to.eq(0)
    expect(await token1.balanceOf(exchange.address)).to.eq(0)

    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()

    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0)
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1)
  })

  it('getReserves', async () => {
    expect(await exchange.getReserves()).to.deep.eq([0, 0].map(n => bigNumberify(n)))

    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    expect(await exchange.getReserves()).to.deep.eq([token0Amount, token1Amount])
  })

  it('getReservesCumulative', async () => {
    await expect(exchange.getReservesCumulative()).to.be.revertedWith('UniswapV2: NOT_INITIALIZED')

    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    expect(await exchange.getReservesCumulative()).to.deep.eq(
      [0, 0, 0, 0].map((n: number): BigNumber => bigNumberify(n))
    )

    const dummySwapAmount = bigNumberify(1)
    await token0.transfer(exchange.address, dummySwapAmount)
    await exchange.connect(wallet).swap(token0.address, wallet.address)

    const reservesCumulativePost = await exchange.getReservesCumulative()
    expect(reservesCumulativePost).to.deep.eq([
      token0Amount.mul(bigNumberify(2)),
      token1Amount.mul(bigNumberify(2)),
      bigNumberify(0),
      bigNumberify(0)
    ])
  })
})
