window.VoodooWallet = (function () {
  const VOODOO_RDNS = 'app.voodoowallet';
  const VOODOO_INSTALL_URL = 'https://github.com/Voodoo-Token/voodoo-pulse-extension';
  const PULSE_CHAIN_ID = 369;
  const PULSE_CHAIN_HEX = '0x171';

  let listenersBound = false;
  /** @type {any} */
  let activeProvider = null;
  /** @type {'voodoo'|'injected'|'rainbow'|null} */
  let activeWalletKind = null;

  function pulsechainNetwork() {
    return window.VoodooConfig.PULSECHAIN_NETWORK;
  }

  function isVoodooProvider(provider) {
    if (!provider) return false;
    if (provider.isVoodooWallet === true || provider._isVoodooWallet === true) return true;
    if (provider === window.voodooEthereum || provider === window.VoodooWalletProvider) return true;
    if (typeof provider.providerInfo?.rdns === 'string'
      && provider.providerInfo.rdns.toLowerCase() === VOODOO_RDNS) {
      return true;
    }
    return false;
  }

  function listInjectedProviders() {
    if (typeof window === 'undefined') return [];
    if (window.location.protocol === 'file:') return [];

    const found = [];
    const push = (p) => {
      if (p && !found.includes(p)) found.push(p);
    };

    push(window.voodooEthereum);
    push(window.VoodooWalletProvider);

    const { ethereum } = window;
    if (ethereum) {
      if (Array.isArray(ethereum.providers) && ethereum.providers.length) {
        ethereum.providers.forEach(push);
      }
      push(ethereum);
    }
    return found;
  }

  function discoverVoodooViaEip6963(timeoutMs = 900) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(null);
        return;
      }

      let found = null;
      let settled = false;

      function finish(provider) {
        if (settled) return;
        settled = true;
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        resolve(provider || null);
      }

      function onAnnounce(event) {
        const detail = event.detail;
        const info = detail?.info;
        const provider = detail?.provider;
        if (!provider) return;

        const rdns = String(info?.rdns || '').toLowerCase();
        const name = String(info?.name || '');
        if (
          rdns === VOODOO_RDNS
          || /voodoo\s*wallet/i.test(name)
          || isVoodooProvider(provider)
        ) {
          found = provider;
          finish(found);
        }
      }

      window.addEventListener('eip6963:announceProvider', onAnnounce);
      try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      } catch {
        /* ignore */
      }

      setTimeout(() => finish(found), timeoutMs);
    });
  }

  function getMetaMaskProvider() {
    const providers = listInjectedProviders();
    if (!providers.length) return null;

    const mm = providers.find((p) => p.isMetaMask && !isVoodooProvider(p));
    if (mm) return mm;

    const anyMm = providers.find((p) => (p.isMetaMask || p._metamask || p.isStatus) && !isVoodooProvider(p));
    if (anyMm) return anyMm;

    const other = providers.find((p) => !isVoodooProvider(p));
    return other || providers[0];
  }

  function findVoodooSync() {
    if (window.voodooEthereum && isVoodooProvider(window.voodooEthereum)) {
      return window.voodooEthereum;
    }
    if (window.VoodooWalletProvider && isVoodooProvider(window.VoodooWalletProvider)) {
      return window.VoodooWalletProvider;
    }
    return listInjectedProviders().find(isVoodooProvider) || null;
  }

  async function getVoodooWalletProvider() {
    const sync = findVoodooSync();
    if (sync) return sync;
    return discoverVoodooViaEip6963(900);
  }

  async function diagnose() {
    const eth = window.ethereum;
    return {
      origin: window.location.origin,
      protocol: window.location.protocol,
      hasEthereum: Boolean(eth),
      ethIsVoodoo: Boolean(eth?.isVoodooWallet),
      ethIsMetaMask: Boolean(eth?.isMetaMask),
      hasVoodooGlobal: Boolean(window.voodooEthereum?.isVoodooWallet),
      providers: listInjectedProviders().map((p, i) => ({
        i,
        isVoodoo: Boolean(p?.isVoodooWallet),
        isMetaMask: Boolean(p?.isMetaMask),
      })),
      eip6963: Boolean(await discoverVoodooViaEip6963(400)),
    };
  }

  async function readChainId(ethereum) {
    try {
      if (ethereum.chainId != null) {
        const raw = ethereum.chainId;
        if (typeof raw === 'string' && raw.startsWith('0x')) return parseInt(raw, 16);
        if (typeof raw === 'number') return raw;
      }
      const hex = await ethereum.request({ method: 'eth_chainId' });
      return parseInt(hex, 16);
    } catch {
      return null;
    }
  }

  async function switchToPulseChain(ethereum) {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: PULSE_CHAIN_HEX }],
      });
    } catch (switchErr) {
      if (switchErr?.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [pulsechainNetwork()],
        });
      } else {
        throw switchErr;
      }
    }
  }

  function mapRequestError(err, kind) {
    const msg = String(err?.message || err || '');
    const code = err?.code;
    if (code === 4001 || /user rejected|rejected the request/i.test(msg)) {
      return new Error('Connection was cancelled in your wallet.');
    }
    if (code === 'VOODOO_TIMEOUT' || /geen antwoord|no response|timed out|timeout/i.test(msg)) {
      return new Error(
        'Voodoo Wallet did not respond. Open the extension, make sure you are signed in, then try again.',
      );
    }
    if (
      code === 4100
      || /unlock voodoo wallet first/i.test(msg)
      || /wallet locked/i.test(msg)
    ) {
      return new Error(
        'Voodoo Wallet is locked. Open the extension, unlock it, then try connecting again.',
      );
    }
    if (code === 'VOODOO_NOT_FOUND' || /not detected|niet gevonden/i.test(msg)) {
      const e = new Error(
        'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.',
      );
      e.code = 'VOODOO_NOT_FOUND';
      e.installUrl = VOODOO_INSTALL_URL;
      return e;
    }
    return err instanceof Error ? err : new Error(msg);
  }

  async function connectWithProvider(ethereum, kind, onStatus) {
    if (!ethereum) {
      if (window.location.protocol === 'file:') {
        throw new Error('Open this site over https (or http://localhost). Browser extensions do not work on file:// pages.');
      }
      throw mapRequestError(
        Object.assign(
          new Error(
            kind === 'voodoo'
              ? 'Voodoo Wallet was not detected. Install or reload the extension, then refresh this page.'
              : 'No browser wallet was found. Install MetaMask or another wallet and try again.',
          ),
          { code: kind === 'voodoo' ? 'VOODOO_NOT_FOUND' : undefined },
        ),
        kind,
      );
    }

    let accounts;
    try {
      onStatus?.('requesting');

      const withTimeout = (p, ms) =>
        Promise.race([
          p,
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error(
                kind === 'voodoo'
                  ? 'Voodoo Wallet did not respond. Close the extension popup if it is stuck, unlock, then click Voodoo Wallet again.'
                  : 'Wallet did not respond. Try again.',
              );
              err.code = 'VOODOO_TIMEOUT';
              reject(err);
            }, ms);
          }),
        ]);

      if (kind === 'voodoo') {
        // Dismiss-detect: closing extension without Reject no longer hangs forever
        accounts = await requestVoodooAccounts(ethereum, {
          isCurrent: ethereum.__voodooIsCurrent,
          timeoutMs: 90_000,
        });
      } else {
        try {
          accounts = await ethereum.request({ method: 'eth_accounts' });
        } catch {
          accounts = [];
        }
        if (!accounts?.length) {
          accounts = await withTimeout(
            ethereum.request({ method: 'eth_requestAccounts' }),
            90_000,
          );
        }
      }
      onStatus?.('connected');
    } catch (err) {
      throw mapRequestError(err, kind);
    }

    if (!accounts?.length) {
      throw new Error(
        'No account was returned by the wallet. Open the extension, unlock it, and try again.',
      );
    }

    let chainId = await readChainId(ethereum);
    if (chainId !== PULSE_CHAIN_ID) {
      try {
        await switchToPulseChain(ethereum);
        await new Promise((r) => setTimeout(r, 400));
        chainId = await readChainId(ethereum);
      } catch (e) {
        console.warn('Chain switch attempt:', e?.message || e);
      }
      // Never throw for rainbow/WC — switch is best-effort
      if (chainId !== PULSE_CHAIN_ID && kind !== 'voodoo' && kind !== 'rainbow') {
        throw new Error('Please switch your wallet to PulseChain (chain ID 369) and try again.');
      }
    }

    let provider;
    let signer;
    let userAddress = accounts[0];
    try {
      // Voodoo: pin PulseChain network so ethers skips getNetwork() round-trips
      // before every tx (those extra RPC calls delay the wallet popup).
      if (kind === 'voodoo' || isVoodooProvider(ethereum)) {
        provider = new ethers.providers.Web3Provider(ethereum, {
          name: 'PulseChain',
          chainId: PULSE_CHAIN_ID,
        });
      } else {
        provider = new ethers.providers.Web3Provider(ethereum, 'any');
      }
      signer = provider.getSigner();
      try {
        const fromSigner = await signer.getAddress();
        if (fromSigner) userAddress = fromSigner;
      } catch {
        /* use accounts[0] */
      }
    } catch (err) {
      console.warn('ethers provider setup warning', err);
      provider = new ethers.providers.Web3Provider(ethereum, {
        name: 'PulseChain',
        chainId: PULSE_CHAIN_ID,
      });
      signer = provider.getSigner();
      userAddress = accounts[0];
    }

    activeProvider = ethereum;
    activeWalletKind = kind;

    return { ethereum, provider, signer, userAddress, walletKind: kind };
  }

  async function connect() {
    return connectOther();
  }

  function waitForRainbowReady(maxMs = 15000) {
    if (window.VoodooRainbow?.ready && window.VoodooRainbow.openConnectModal) {
      return Promise.resolve(window.VoodooRainbow);
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      function check() {
        if (window.VoodooRainbow?.ready && window.VoodooRainbow.openConnectModal) {
          cleanup();
          resolve(window.VoodooRainbow);
          return;
        }
        if (Date.now() - started >= maxMs) {
          cleanup();
          reject(new Error('RainbowKit is still loading. Refresh the page and try again.'));
        }
      }
      function onReady() {
        check();
      }
      function cleanup() {
        window.removeEventListener('voodoo:rainbow-ready', onReady);
        clearInterval(timer);
      }
      window.addEventListener('voodoo:rainbow-ready', onReady);
      const timer = setInterval(check, 100);
      check();
    });
  }

  let pendingRainbowConnect = null;
  let pendingReject = null;
  let connectEpoch = 0;

  function cancelPendingRainbow(reason = 'cancelled') {
    if (typeof pendingReject === 'function') {
      const err = new Error(reason);
      err.code = 'ACTION_REJECTED';
      try {
        pendingReject(err);
      } catch {
        /* ignore */
      }
    }
    pendingReject = null;
    pendingRainbowConnect = null;
  }

  /**
   * Wait for RainbowKit connection event only.
   * Opening the modal is done by app.js via VoodooRainbow.openConnectModal first.
   */
  async function connectOther(onStatus) {
    onStatus?.('opening');
    await waitForRainbowReady();

    // Already wired
    if (activeProvider && activeWalletKind === 'rainbow') {
      try {
        const provider = new ethers.providers.Web3Provider(activeProvider, 'any');
        const signer = provider.getSigner();
        const userAddress = await signer.getAddress();
        return {
          ethereum: activeProvider,
          provider,
          signer,
          userAddress,
          walletKind: 'rainbow',
        };
      } catch {
        clearActiveWallet();
      }
    }

    if (pendingRainbowConnect) {
      cancelPendingRainbow('restart');
    }

    const epoch = ++connectEpoch;

    pendingRainbowConnect = new Promise((resolve, reject) => {
      let settled = false;
      pendingReject = reject;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (pendingReject === reject) pendingReject = null;
        window.removeEventListener('voodoo:rainbow-connected', onConnected);
        window.removeEventListener('voodoo:rainbow-error', onError);
      };

      const timer = setTimeout(() => {
        if (settled || epoch !== connectEpoch) return;
        cleanup();
        const err = new Error('Wallet connection timed out. Click Other to try again.');
        err.code = 'TIMEOUT';
        reject(err);
      }, 180_000);

      async function onConnected(event) {
        if (settled || epoch !== connectEpoch) return;
        const detail = event?.detail || {};
        const provider = detail.provider;
        const preAddress = detail.address;
        if (!provider) {
          cleanup();
          reject(new Error('Wallet connected but no provider was returned.'));
          return;
        }
        cleanup();
        try {
          onStatus?.('connected');
          const result = await connectWithProvider(provider, 'rainbow', onStatus);
          if (!result.userAddress && preAddress) result.userAddress = preAddress;
          resolve(result);
        } catch (err) {
          clearActiveWallet();
          try {
            await window.VoodooRainbow?.hardReset?.();
          } catch {
            /* ignore */
          }
          reject(mapRequestError(err, 'rainbow'));
        }
      }

      function onError(event) {
        if (settled || epoch !== connectEpoch) return;
        cleanup();
        reject(new Error(event?.detail?.message || 'Wallet connection failed.'));
      }

      window.addEventListener('voodoo:rainbow-connected', onConnected);
      window.addEventListener('voodoo:rainbow-error', onError);
      // Modal is already opened by app.js — we only wait for the wallet event
    }).finally(() => {
      if (epoch === connectEpoch) {
        pendingRainbowConnect = null;
        pendingReject = null;
      }
    });

    return pendingRainbowConnect;
  }

  async function connectVoodoo(onStatus) {
    // Only runs from the Voodoo Wallet BUTTON click (user gesture).
    const gen = ++voodooConnectGen;
    const isCurrent = () => gen === voodooConnectGen;

    onStatus?.('detecting');
    const ethereum = await getVoodooWalletProvider();
    if (!ethereum) {
      const info = await diagnose();
      if (window.VoodooDebug === true || window.VoodooUI?.isDebug?.()) {
        console.error('[Voodoo diagnose]', info);
      }
      const err = new Error(
        'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.',
      );
      err.code = 'VOODOO_NOT_FOUND';
      err.installUrl = VOODOO_INSTALL_URL;
      err.diagnose = info;
      throw err;
    }
    if (!isCurrent()) {
      const err = new Error('restart');
      err.code = 'ACTION_REJECTED';
      throw err;
    }

    onStatus?.('opening');
    clearActiveWallet();

    // One open per click — no wallet_requestPermissions (that re-opened randomly)
    ethereum.__voodooIsCurrent = isCurrent;

    try {
      return await connectWithProvider(ethereum, 'voodoo', onStatus);
    } finally {
      try {
        delete ethereum.__voodooIsCurrent;
      } catch {
        /* ignore */
      }
    }
  }

  function getActiveProvider() {
    return activeProvider || findVoodooSync() || getMetaMaskProvider();
  }

  function getActiveWalletKind() {
    return activeWalletKind;
  }

  function clearActiveWallet() {
    activeProvider = null;
    activeWalletKind = null;
  }

  /**
   * One eth_requestAccounts per button click only.
   * No focus/blur auto-logic (that re-opened the wallet after click-away).
   * Newer button click supersedes this waiter without opening another popup by itself.
   */
  function requestVoodooAccounts(ethereum, { isCurrent, timeoutMs = 120_000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (ok, val) => {
        if (settled) return;
        if (typeof isCurrent === 'function' && !isCurrent()) {
          settled = true;
          clearTimeout(hardTimer);
          return;
        }
        settled = true;
        clearTimeout(hardTimer);
        if (ok) resolve(val);
        else reject(val);
      };

      const hardTimer = setTimeout(() => {
        const err = new Error(
          'Voodoo Wallet did not respond. Click Voodoo Wallet again.',
        );
        err.code = 'VOODOO_TIMEOUT';
        finish(false, err);
      }, timeoutMs);

      ethereum
        .request({ method: 'eth_requestAccounts' })
        .then((accs) => finish(true, accs || []))
        .catch((err) => finish(false, err));
    });
  }

  let voodooConnectGen = 0;

  function bindListeners(onAccountsChanged, onChainChanged) {
    const ethereum = getActiveProvider();
    if (!ethereum) return;

    if (listenersBound && ethereum === activeProvider) return;
    listenersBound = true;

    try {
      ethereum.on('accountsChanged', (accounts) => {
        if (!accounts?.length) {
          clearActiveWallet();
          onAccountsChanged?.(null);
          return;
        }
        onAccountsChanged?.(accounts[0]);
      });

      ethereum.on('chainChanged', () => {
        onChainChanged?.();
      });
    } catch (e) {
      console.warn('Wallet event listeners not supported', e);
    }
  }

  async function registerVoodooToken(ethereum) {
    const target = ethereum || getActiveProvider();
    if (!target || isVoodooProvider(target)) return;

    const { VDO_ADDRESS } = window.VoodooConfig;
    const image = window.StakingPlatformV4?.getVoodooLogoUrl?.()
      || `${window.location.origin}/Voodoo-Token-Logo.png`;

    try {
      await target.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: VDO_ADDRESS,
            symbol: 'VDO',
            decimals: 18,
            image,
          },
        },
      });
    } catch (e) {
      console.warn('Token logo registration skipped', e);
    }
  }

  return {
    getMetaMaskProvider,
    getVoodooWalletProvider,
    isVoodooProvider,
    connect,
    connectOther,
    connectVoodoo,
    connectWithProvider,
    waitForRainbowReady,
    bindListeners,
    registerVoodooToken,
    getActiveProvider,
    getActiveWalletKind,
    clearActiveWallet,
    cancelPendingRainbow,
    diagnose,
    VOODOO_INSTALL_URL,
  };
})();
