/**
 * Public RPC helpers — same pattern as StakingPlatform-V4.
 * Never use the injected wallet for eth_call / receipts after tx send
 * (Voodoo Wallet can hang on estimateGas / getTransactionReceipt).
 */
window.VoodooContracts = (function () {
  const PUBLIC_RPCS = [
    'https://pulsechain.publicnode.com',
    'https://rpc.pulsechain.com',
    'https://pulsechain-rpc.publicnode.com',
  ];

  function rpcUrls() {
    return PUBLIC_RPCS.slice();
  }

  function makeProvider(url) {
    return new ethers.providers.StaticJsonRpcProvider(url, {
      name: 'PulseChain',
      chainId: 369,
    });
  }

  function readProvider() {
    return makeProvider(rpcUrls()[0]);
  }

  async function withReadFailover(fn) {
    let lastErr;
    for (const url of rpcUrls()) {
      try {
        return await fn(makeProvider(url));
      } catch (err) {
        lastErr = err;
        console.warn('[VoodooContracts] read failed on', url, err?.message || err);
      }
    }
    throw lastErr || new Error('All PulseChain RPCs failed');
  }

  function lotteryAddress() {
    return (
      window.VoodooConfig?.LOTTERY_ADDRESS ||
      '0x560B17793300d5C27Dc2dFbedd09740edBB2d35b'
    );
  }

  function vdoAddress() {
    return (
      window.VoodooConfig?.VDO_ADDRESS ||
      '0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00'
    );
  }

  function readLottery(provider) {
    const p = provider || readProvider();
    return new ethers.Contract(
      lotteryAddress(),
      window.VoodooConfig.LOTTERY_ABI,
      p,
    );
  }

  function readVdo(provider) {
    const p = provider || readProvider();
    return new ethers.Contract(vdoAddress(), window.VoodooConfig.TOKEN_ABI, p);
  }

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(label || `Timed out after ${ms}ms`);
          err.code = 'TIMEOUT';
          reject(err);
        }, ms);
      }),
    ]);
  }

  /**
   * Wait for receipt on public RPC (never wallet injector).
   * Each RPC call is timed out so a hung node cannot freeze the dapp.
   */
  async function waitForReceipt(txHash, maxMs = 45_000) {
    if (!txHash) return null;
    const started = Date.now();
    let lastErr;
    while (Date.now() - started < maxMs) {
      for (const url of rpcUrls()) {
        try {
          const receipt = await withTimeout(
            makeProvider(url).getTransactionReceipt(txHash),
            4000,
            'RPC receipt timeout',
          );
          if (receipt) return receipt;
        } catch (err) {
          lastErr = err;
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (lastErr) {
      console.warn('[VoodooContracts] waitForReceipt timeout', txHash, lastErr);
    }
    return null;
  }

  /** Timed read so RPC hang never freezes UI forever */
  async function withReadFailoverTimed(fn, perRpcMs = 5000) {
    let lastErr;
    for (const url of rpcUrls()) {
      try {
        return await withTimeout(fn(makeProvider(url)), perRpcMs, 'RPC read timeout');
      } catch (err) {
        lastErr = err;
        console.warn('[VoodooContracts] read failed on', url, err?.message || err);
      }
    }
    throw lastErr || new Error('All PulseChain RPCs failed');
  }

  return {
    readProvider,
    readLottery,
    readVdo,
    withReadFailover,
    withReadFailoverTimed,
    waitForReceipt,
    withTimeout,
    lotteryAddress,
    vdoAddress,
    rpcUrls,
  };
})();
