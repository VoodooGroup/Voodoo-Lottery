/**
 * Voodoo Lottery — dual wallet header (same pattern as StakingPlatform-V4)
 * + original lottery approve / join / pool logic.
 */
(function () {
  const LOTTERY_ADDRESS =
    window.VoodooConfig?.LOTTERY_ADDRESS ||
    '0x560B17793300d5C27Dc2dFbedd09740edBB2d35b';
  const TOKEN_ADDRESS =
    window.VoodooConfig?.VDO_ADDRESS ||
    '0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00';
  const LOTTERY_ABI = window.VoodooConfig?.LOTTERY_ABI;
  const TOKEN_ABI = window.VoodooConfig?.TOKEN_ABI;

  let provider = null;
  let signer = null;
  let lottery = null;
  let token = null;
  let userAddress = null;
  /** True when lottery already has VDO spending allowance */
  let isApproved = false;
  /** Bumps on each balance/approve sync so stale RPC results cannot rewrite the Approve label */
  let approveUiGen = 0;
  /**
   * Status line sessions — only the latest session may write the status bar.
   * Prevents: "Connected! You can buy a ticket" → flash → "Error loading pools" / "Checking…"
   */
  let statusSession = 0;
  /** True after first successful wallet setup this page load (listeners bound once) */
  let walletListenersReady = false;
  /** In-flight connect setup — ignore duplicate account events */
  let connectInFlight = false;

  if (typeof ethers === 'undefined') {
    const status = document.getElementById('status');
    if (status) {
      status.innerText =
        'Error: ethers.js not loaded. Reload page or try later.';
    }
    console.error('ethers not defined – CDN issue');
  }

  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  function shortAddress(addr) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('status');
    if (!el) return;
    if (isError) {
      el.innerHTML = `<span class="error-msg">${String(msg || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</span>`;
    } else {
      el.textContent = msg;
    }
  }

  /** Start a new status owner (connect / approve / join). Invalidates older writers. */
  function beginStatusSession() {
    statusSession += 1;
    return statusSession;
  }

  /** Write status only if this session is still current. */
  function setStatusSession(session, msg, isError) {
    if (session !== statusSession) return false;
    setStatus(msg, isError);
    return true;
  }

  function sameAddress(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  /** Idle connected status — one stable line, no intermediate flicker */
  function connectedReadyMessage() {
    return 'Connected — pick a ticket to buy.';
  }

  function setVoodooBtnLabel(address) {
    const btn = document.getElementById('voodooWalletBtn');
    if (!btn) return;
    btn.textContent = address ? shortAddress(address) : 'Voodoo Wallet';
  }

  function resetConnectButtons() {
    const connectBtn = document.getElementById('connectBtn');
    const voodooBtn = document.getElementById('voodooWalletBtn');

    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.classList.remove('is-connected');
      connectBtn.textContent = 'Other';
      connectBtn.title =
        'RainbowKit: WalletConnect, MetaMask, Rabby, Trust, …';
    }
    if (voodooBtn) {
      voodooBtn.disabled = false;
      voodooBtn.classList.remove('is-connected');
      setVoodooBtnLabel(null);
      voodooBtn.title = 'Connect with Voodoo Wallet browser extension';
    }
  }

  function isOtherWalletKind(kind) {
    return kind === 'rainbow' || kind === 'injected';
  }

  function markConnectedUi(kind, address) {
    const connectBtn = document.getElementById('connectBtn');
    const voodooBtn = document.getElementById('voodooWalletBtn');
    const label = shortAddress(address);

    if (kind === 'voodoo') {
      if (voodooBtn) {
        voodooBtn.disabled = false;
        voodooBtn.classList.add('is-connected');
        setVoodooBtnLabel(address);
        voodooBtn.title = address
          ? `Connected with Voodoo Wallet: ${address}`
          : 'Connected with Voodoo Wallet';
      }
      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.classList.remove('is-connected');
        connectBtn.textContent = 'Other';
        connectBtn.title = 'Already connected with Voodoo Wallet';
      }
      return;
    }

    // Other (RainbowKit / MetaMask / WC / …)
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.classList.add('is-connected');
      connectBtn.textContent = label || 'Other';
      connectBtn.title = address ? `Connected: ${address}` : 'Connected';
    }
    if (voodooBtn) {
      voodooBtn.disabled = true;
      voodooBtn.classList.remove('is-connected');
      setVoodooBtnLabel(null);
      voodooBtn.title = 'Already connected with another wallet';
    }
  }

  /** Track on-chain allowance state (no separate Approve button). */
  function setApprovedState(approved) {
    isApproved = Boolean(approved);
  }

  function allowanceIsApproved(allow) {
    try {
      if (allow == null) return false;
      if (typeof allow.gt === 'function') return allow.gt(0);
      return Number(allow) > 0;
    } catch {
      return false;
    }
  }

  async function readAllowance() {
    const reader =
      window.VoodooContracts.withReadFailoverTimed ||
      window.VoodooContracts.withReadFailover;
    return reader((p) =>
      window.VoodooContracts.readVdo(p).allowance(userAddress, LOTTERY_ADDRESS),
    );
  }

  function resetWalletUi() {
    provider = null;
    signer = null;
    lottery = null;
    token = null;
    userAddress = null;
    isApproved = false;
    approveUiGen += 1;
    connectInFlight = false;
    beginStatusSession(); // invalidate pending connect/tx status writers
    window.VoodooWallet?.clearActiveWallet?.();
    resetConnectButtons();

    const addrEl = document.getElementById('address');
    const balEl = document.getElementById('balance');
    if (addrEl) addrEl.textContent = '---';
    if (balEl) balEl.textContent = '0';

    setApprovedState(false);
    setStatus('Connect your wallet to start...');
  }

  const VOODOO_MISSING_MSG =
    'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.';

  function connectionErrorMessage(err) {
    if (!err) return 'Something went wrong. Please try again.';
    const msg = err.message || String(err);
    if (
      err.code === 4001 ||
      err.code === 'ACTION_REJECTED' ||
      /user rejected|user denied|rejected the request/i.test(msg)
    ) {
      return 'Connection was cancelled in your wallet.';
    }
    if (
      err.code === 'VOODOO_NOT_FOUND' ||
      /Voodoo Wallet not detected|not detected/i.test(msg)
    ) {
      return VOODOO_MISSING_MSG;
    }
    if (
      /MetaMask|no ethereum|no injected|wallet not found/i.test(msg)
    ) {
      return 'No browser wallet was found. Install MetaMask (or another wallet), then try again.';
    }
    return (
      msg
        .replace(/\[debug\][\s\S]*/i, '')
        .replace(/\ncode=[\s\S]*/i, '')
        .trim() || 'Connection failed. Please try again.'
    );
  }

  async function showConnectError(title, err) {
    console.error(title, err);
    const message = connectionErrorMessage(err);
    // Same popup as Plinko/Miner: title + message + OK only (no install link)
    const dialogTitle =
      err?.code === 'VOODOO_NOT_FOUND' ||
      /Voodoo Wallet not detected|not detected/i.test(err?.message || '')
        ? 'Voodoo Wallet'
        : title || 'Voodoo Wallet';
    if (window.VoodooUI?.alert) {
      return window.VoodooUI.alert(message, {
        title: dialogTitle,
        type: 'error',
        okText: 'OK',
      });
    }
    setStatus(message, true);
    return undefined;
  }

  async function onWalletConnected(result) {
    // Same account reconnect (extension noise) — silent refresh only, no status flash
    if (
      userAddress &&
      sameAddress(userAddress, result.userAddress) &&
      provider &&
      !connectInFlight
    ) {
      signer = result.signer;
      provider = result.provider;
      lottery = new ethers.Contract(LOTTERY_ADDRESS, LOTTERY_ABI, signer);
      token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      await updateBalanceAndAllowance({ preferApproved: isApproved });
      updatePools().catch(() => {});
      return;
    }

    if (connectInFlight && sameAddress(userAddress, result.userAddress)) {
      return;
    }

    connectInFlight = true;
    const session = beginStatusSession();

    provider = result.provider;
    signer = result.signer;
    userAddress = result.userAddress;

    lottery = new ethers.Contract(LOTTERY_ADDRESS, LOTTERY_ABI, signer);
    token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

    const kind =
      result.walletKind ||
      window.VoodooWallet.getActiveWalletKind() ||
      'injected';
    markConnectedUi(kind, userAddress);

    document.getElementById('address').innerText = shortAddress(userAddress);

    // Bind account/chain listeners once
    if (!walletListenersReady) {
      walletListenersReady = true;
      window.VoodooWallet.bindListeners(
        async (account) => {
          if (!account) {
            resetWalletUi();
            return;
          }
          // Same wallet account — do not re-run full connect UI
          if (sameAddress(account, userAddress)) {
            updateBalanceAndAllowance({ preferApproved: isApproved }).catch(
              () => {},
            );
            return;
          }
          try {
            const k = window.VoodooWallet.getActiveWalletKind() || 'injected';
            const ethereum = window.VoodooWallet.getActiveProvider();
            const reconnect = await window.VoodooWallet.connectWithProvider(
              ethereum,
              k,
            );
            await onWalletConnected(reconnect);
          } catch (e) {
            console.error(e);
            resetWalletUi();
          }
        },
        () => window.location.reload(),
      );
    }

    try {
      // Non-blocking — must not delay or rewrite status
      window.VoodooWallet.registerVoodooToken?.(result.ethereum)?.catch?.(
        (e) => console.warn('Token logo registration skipped', e),
      );
    } catch (e) {
      console.warn('Token logo registration skipped', e);
    }

    try {
      await updateBalanceAndAllowance();
      setStatusSession(session, connectedReadyMessage());
    } catch (e) {
      console.error(e);
      setStatusSession(session, connectedReadyMessage());
    } finally {
      connectInFlight = false;
    }

    // Pools: never touch the status bar (that caused the flash after "ready to buy")
    updatePools().catch((e) => console.warn('Pool refresh failed', e));
  }

  function bindConnectButton() {
    const btn = document.getElementById('connectBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', async () => {
      btn.disabled = false;

      // Already connected via Other → open account modal
      if (
        userAddress &&
        isOtherWalletKind(window.VoodooWallet.getActiveWalletKind())
      ) {
        btn.textContent = shortAddress(userAddress);
        try {
          await window.VoodooRainbow?.openConnectModal?.({ mode: 'account' });
        } catch (e) {
          console.warn(e);
        }
        return;
      }

      btn.textContent = 'Other';

      if (!window.VoodooRainbow?.ready) {
        await showConnectError(
          'Wallets still loading',
          new Error(
            'RainbowKit is not ready yet. Wait 2 seconds and click Other again.',
          ),
        );
        return;
      }

      try {
        const opened = await window.VoodooRainbow.openConnectModal({
          mode: 'connect',
          forceConnect: true,
        });
        if (opened === false) {
          try {
            await window.VoodooRainbow?.hardReset?.();
            if (typeof window.__voodooRemountRainbowKit === 'function') {
              window.__voodooRemountRainbowKit();
              await new Promise((r) => setTimeout(r, 400));
            }
            const again = await window.VoodooRainbow?.openConnectModal?.({
              mode: 'connect',
              forceConnect: true,
            });
            if (again === false) {
              await showConnectError(
                'Could not open wallet list',
                new Error(
                  'Modal did not open. Refresh the page (F5) and try again.',
                ),
              );
              return;
            }
          } catch (e2) {
            await showConnectError('Could not open wallet list', e2);
            return;
          }
        }
      } catch (e) {
        await showConnectError('Could not open wallet list', e);
        return;
      }

      try {
        window.VoodooWallet?.cancelPendingRainbow?.('restart');
        const result = await window.VoodooWallet.connectOther();
        if (result?.userAddress) {
          await onWalletConnected(result);
        }
      } catch (err) {
        const quiet =
          err?.code === 'TIMEOUT' ||
          err?.code === 4001 ||
          err?.code === 'ACTION_REJECTED' ||
          err?.code === 'restart' ||
          /timed out|cancelled|rejected|denied|restart/i.test(
            err?.message || '',
          );
        if (!quiet) console.error('RainbowKit connect error', err);
        try {
          await window.VoodooRainbow?.hardReset?.();
        } catch {
          /* ignore */
        }
        if (!userAddress) btn.textContent = 'Other';
      }
    });
  }

  function bindVoodooWalletButton() {
    const btn = document.getElementById('voodooWalletBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    let clickGen = 0;

    btn.addEventListener('click', async () => {
      if (
        userAddress &&
        window.VoodooWallet.getActiveWalletKind() === 'voodoo'
      ) {
        return;
      }

      const gen = ++clickGen;
      btn.disabled = false;
      setVoodooBtnLabel(null);

      try {
        window.VoodooWallet.clearActiveWallet?.();
        const result = await window.VoodooWallet.connectVoodoo();
        if (gen !== clickGen) return;
        await onWalletConnected(result);
      } catch (err) {
        if (gen !== clickGen) return;
        resetWalletUi();
        setVoodooBtnLabel(null);
        const quiet =
          err?.code === 4001 ||
          err?.code === 'ACTION_REJECTED' ||
          err?.code === 'VOODOO_TIMEOUT' ||
          /reject|denied|cancel|did not respond/i.test(err?.message || '');
        if (!quiet) {
          await showConnectError('Voodoo Wallet connection failed', err);
        }
      } finally {
        if (gen === clickGen) {
          if (
            !(
              userAddress &&
              window.VoodooWallet.getActiveWalletKind() === 'voodoo'
            )
          ) {
            btn.disabled = false;
            if (!userAddress) setVoodooBtnLabel(null);
          }
        }
      }
    });
  }

  // —— Lottery txs: same Voodoo-safe pattern as staking ——
  // 1) Explicit gasLimit → skips eth_estimateGas through extension (slow/hang)
  // 2) Public-RPC receipt wait → wallet tx.wait() hangs on Voodoo after confirm

  const GAS_APPROVE = 120000;
  /** Join + transfer + possible draw — headroom so wallet does not re-estimate */
  const GAS_JOIN = 550000;
  /** Wallet popup must answer within this (user can cancel or retry) */
  const WALLET_TX_MS = 90_000;
  /** Receipt poll cap — do not freeze UI for minutes */
  const RECEIPT_MS = 40_000;
  /** Whole buy flow hard cap */
  const FLOW_MS = 180_000;

  let txBusy = false;
  let busyUnlockTimer = null;

  function isQuietWalletCancel(err) {
    const msg = String(
      err?.reason || err?.data?.message || err?.message || err || '',
    ).toLowerCase();
    const code = err?.code;
    return (
      code === 4001 ||
      code === 'ACTION_REJECTED' ||
      code === 'VOODOO_TIMEOUT' ||
      code === 'TIMEOUT' ||
      code === -32000 ||
      /user rejected|user denied|rejected the request|rejected|timeout|timed out|cancel|aborted/i.test(
        msg,
      )
    );
  }

  function setJoinButtonsDisabled(disabled) {
    document.querySelectorAll('.join-btn').forEach((b) => {
      b.disabled = disabled;
    });
  }

  function unlockUi(session, msg) {
    txBusy = false;
    setJoinButtonsDisabled(false);
    if (busyUnlockTimer) {
      clearTimeout(busyUnlockTimer);
      busyUnlockTimer = null;
    }
    if (msg && session != null) setStatusSession(session, msg);
  }

  function withTimeout(promise, ms, message) {
    if (window.VoodooContracts?.withTimeout) {
      return window.VoodooContracts.withTimeout(promise, ms, message);
    }
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(message || 'Timed out');
          err.code = 'TIMEOUT';
          reject(err);
        }, ms);
      }),
    ]);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Send write tx (timed), then confirm on public RPC (timed).
   * Never hang forever on wallet popup or RPC.
   */
  async function sendAndWait(sendFn, { pendingLabel, session, confirmLabel }) {
    const s = session != null ? session : beginStatusSession();
    setStatusSession(s, confirmLabel || 'Confirm in wallet…');

    let tx;
    try {
      tx = await withTimeout(
        sendFn(),
        WALLET_TX_MS,
        'Wallet did not respond. Close any stuck popup and try again.',
      );
    } catch (err) {
      if (err?.code === 'TIMEOUT') throw err;
      throw err;
    }

    const hash = tx?.hash || tx;
    if (!hash) {
      throw new Error('No transaction hash returned from wallet.');
    }

    setStatusSession(s, pendingLabel || 'Pending on PulseChain…');

    // Do not await wallet receipt — it often hangs
    if (tx?.wait) {
      tx.wait(1).catch(() => null);
    }

    const receipt = window.VoodooContracts?.waitForReceipt
      ? await window.VoodooContracts.waitForReceipt(hash, RECEIPT_MS)
      : await withTimeout(
          tx.wait?.(1).catch(() => null),
          RECEIPT_MS,
          'Receipt timeout',
        ).catch(() => null);

    if (!receipt) {
      console.warn('Tx submitted; confirmation timed out:', hash);
      // Still return hash so flow can continue (e.g. approve → buy)
      return { hash, receipt: null, ok: null, session: s };
    }

    const status = receipt.status;
    const ok = status === 1 || status === '0x1' || Number(status) === 1;
    if (!ok) {
      throw new Error('Transaction reverted on-chain');
    }
    return { hash, receipt, ok: true, session: s };
  }

  /** Poll allowance quickly after approve so we do not wait on slow receipts */
  async function waitUntilAllowance(maxMs = 25_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const allow = await withTimeout(readAllowance(), 4000, 'allowance timeout');
        if (allowanceIsApproved(allow)) return true;
      } catch {
        /* retry */
      }
      await sleep(800);
    }
    return false;
  }

  /**
   * Ensure lottery can spend VDO. If already approved → no-op.
   * Otherwise one approve tx, then proceed as soon as allowance is visible.
   * @returns {Promise<{ justApproved: boolean }>}
   */
  async function ensureApproved(session) {
    if (!token || !userAddress) throw new Error('Wallet not connected');

    // Fast path: already approved
    try {
      const allow = await withTimeout(readAllowance(), 5000, 'allowance timeout');
      if (allowanceIsApproved(allow)) {
        setApprovedState(true);
        return { justApproved: false };
      }
      setApprovedState(false);
    } catch {
      setApprovedState(false);
    }

    const result = await sendAndWait(
      () =>
        token.approve(LOTTERY_ADDRESS, ethers.constants.MaxUint256, {
          gasLimit: GAS_APPROVE,
        }),
      {
        confirmLabel: 'Step 1/2 — confirm Approve VDO in your wallet…',
        pendingLabel: 'Step 1/2 — approval pending…',
        session,
      },
    );

    if (!result.hash && result.ok !== true) {
      throw new Error('Approval was not confirmed');
    }

    // Prefer allowance visibility over full receipt wait
    setStatusSession(session, 'Step 1/2 — waiting for allowance…');
    const ok = await waitUntilAllowance(25_000);
    if (ok || result.ok === true || result.hash) {
      setApprovedState(true);
      await sleep(350); // let wallet close popup before buy
      return { justApproved: true };
    }
    throw new Error('Approval not confirmed in time — try again');
  }

  window.joinPool = async function joinPool(pool) {
    if (!signer || !lottery || !token) {
      if (window.VoodooUI?.alert) {
        await window.VoodooUI.alert('Connect wallet first!', {
          title: 'Wallet required',
          type: 'warning',
        });
      } else {
        alert('Connect wallet first!');
      }
      return;
    }
    if (txBusy) {
      // Safety: if stuck somehow, force unlock on double-click after message
      setStatus('Still busy — wait a moment, or click again to unlock…');
      unlockUi(null);
      return;
    }

    txBusy = true;
    const session = beginStatusSession();
    setJoinButtonsDisabled(true);

    // Absolute safety net — never leave buttons disabled forever
    if (busyUnlockTimer) clearTimeout(busyUnlockTimer);
    busyUnlockTimer = setTimeout(() => {
      if (txBusy) {
        console.warn('[joinPool] hard unlock after FLOW_MS');
        unlockUi(session, 'Timed out — UI unlocked. Try again.');
      }
    }, FLOW_MS);

    const joinFns = {
      1: () => lottery.joinBronze({ gasLimit: GAS_JOIN }),
      2: () => lottery.joinSilver({ gasLimit: GAS_JOIN }),
      3: () => lottery.joinGold({ gasLimit: GAS_JOIN }),
      4: () => lottery.joinDiamond({ gasLimit: GAS_JOIN }),
    };
    const send = joinFns[pool];
    if (!send) {
      unlockUi(session, 'Unknown pool');
      return;
    }

    try {
      const flow = (async () => {
        const { justApproved } = await ensureApproved(session);

        const buyConfirm = justApproved
          ? 'Step 2/2 — confirm Buy ticket in your wallet…'
          : 'Confirm Buy ticket in your wallet…';
        const buyPending = justApproved
          ? 'Step 2/2 — ticket purchase pending…'
          : 'Ticket purchase pending…';

        const result = await sendAndWait(send, {
          confirmLabel: buyConfirm,
          pendingLabel: buyPending,
          session,
        });
        if (result.ok === true || result.hash) {
          setStatusSession(session, 'Success — joined the pool.');
        } else {
          setStatusSession(
            session,
            'Submitted — check wallet activity if the pool did not update.',
          );
        }
        // Non-blocking refresh so UI unlocks even if RPC is slow
        updatePools().catch(() => {});
        updateBalanceAndAllowance({ preferApproved: true }).catch(() => {});
      })();

      await withTimeout(
        flow,
        FLOW_MS,
        'This took too long. UI unlocked — try again.',
      );
    } catch (e) {
      console.error('Buy ticket failed', e);
      if (e?.code === 'TIMEOUT' || /timed out|too long/i.test(e?.message || '')) {
        setStatusSession(
          session,
          e.message || 'Timed out — try again.',
          true,
        );
      } else if (!isQuietWalletCancel(e)) {
        setStatusSession(session, e?.message || 'Buy failed', true);
      } else {
        setStatusSession(session, 'Cancelled in wallet.');
      }
    } finally {
      unlockUi(null);
    }
  };

  /**
   * Balance / allowance via public RPC (updates isApproved flag only).
   */
  async function updateBalanceAndAllowance(opts = {}) {
    const preferApproved = Boolean(opts.preferApproved) || isApproved;
    if (!userAddress) return;

    const gen = ++approveUiGen;

    try {
      const { bal, allow } = await window.VoodooContracts.withReadFailover(
        async (p) => {
          const vdo = window.VoodooContracts.readVdo(p);
          const [b, a] = await Promise.all([
            vdo.balanceOf(userAddress),
            vdo.allowance(userAddress, LOTTERY_ADDRESS),
          ]);
          return { bal: b, allow: a };
        },
      );

      if (gen !== approveUiGen) return;

      document.getElementById('balance').innerText = Number(
        ethers.utils.formatUnits(bal, 18),
      ).toLocaleString();
      const allowEl = document.getElementById('allowance');
      if (allowEl) {
        allowEl.innerText = Number(
          ethers.utils.formatUnits(allow, 18),
        ).toLocaleString();
      }

      if (allowanceIsApproved(allow)) {
        setApprovedState(true);
      } else if (!preferApproved) {
        setApprovedState(false);
      }
    } catch (e) {
      if (gen !== approveUiGen) return;
      if (!token) return;
      try {
        const bal = await token.balanceOf(userAddress);
        if (gen !== approveUiGen) return;
        document.getElementById('balance').innerText = Number(
          ethers.utils.formatUnits(bal, 18),
        ).toLocaleString();
        try {
          const allow = await token.allowance(userAddress, LOTTERY_ADDRESS);
          if (gen !== approveUiGen) return;
          if (allowanceIsApproved(allow)) setApprovedState(true);
        } catch {
          /* ignore */
        }
      } catch (e2) {
        console.error(e2);
      }
    }
  }

  function formatVdo(bn) {
    try {
      return (
        Number(ethers.utils.formatUnits(bn, 18)).toLocaleString() + ' VDO'
      );
    } catch {
      return '—';
    }
  }

  function paintPoolRow(id, current, max, ticketPrice) {
    const cur = Number(current.toString());
    const mx = Number(max.toString());
    const slots = Math.max(0, mx - cur);
    const set = (elId, text) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = text;
    };
    set(`current${id}`, String(cur));
    set(`max${id}`, String(mx));
    set(`price${id}`, formatVdo(ticketPrice));
    set(`win${id}`, formatVdo(ticketPrice.mul(2)));
    set(`slots${id}`, String(slots));
  }

  /**
   * Live pool table via public PulseChain RPC — no wallet required.
   * Visitors always see on-chain Current / slots / prices.
   */
  async function updatePools() {
    const readAll = async (provider) => {
      const lotteryRead = window.VoodooContracts.readLottery(provider);
      const [p1, p2, p3, p4] = await Promise.all([
        lotteryRead.getBronzeStatus(),
        lotteryRead.getSilverStatus(),
        lotteryRead.getGoldStatus(),
        lotteryRead.getDiamondStatus(),
      ]);
      return { p1, p2, p3, p4 };
    };

    try {
      const reader =
        window.VoodooContracts.withReadFailoverTimed ||
        window.VoodooContracts.withReadFailover;
      // Whole multi-call on one RPC with failover + timeout
      const { p1, p2, p3, p4 } = await reader(
        (provider) => readAll(provider),
        8000,
      );

      paintPoolRow(1, p1[0], p1[1], p1[2]);
      paintPoolRow(2, p2[0], p2[1], p2[2]);
      paintPoolRow(3, p3[0], p3[1], p3[2]);
      paintPoolRow(4, p4[0], p4[1], p4[2]);
      return true;
    } catch (e) {
      console.warn('[pools] public RPC failed', e?.message || e);
      // Wallet-bound contract only as last resort (visitor path has no lottery)
      if (!lottery) return false;
      try {
        const [p1, p2, p3, p4] = await Promise.all([
          lottery.getBronzeStatus(),
          lottery.getSilverStatus(),
          lottery.getGoldStatus(),
          lottery.getDiamondStatus(),
        ]);
        paintPoolRow(1, p1[0], p1[1], p1[2]);
        paintPoolRow(2, p2[0], p2[1], p2[2]);
        paintPoolRow(3, p3[0], p3[1], p3[2]);
        paintPoolRow(4, p4[0], p4[1], p4[2]);
        return true;
      } catch (e2) {
        console.error('[pools] wallet read failed', e2);
        return false;
      }
    }
  }

  /** Keep table fresh for all visitors (no wallet). */
  function startPoolAutoRefresh() {
    // Immediate load
    updatePools().catch((e) => console.warn(e));
    // Refresh every 12s so buys show up without reload
    setInterval(() => {
      updatePools().catch(() => {});
    }, 12_000);
    // Refresh when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        updatePools().catch(() => {});
      }
    });
  }

  function init() {
    bindConnectButton();
    bindVoodooWalletButton();
    // Load live pool status for everyone — no connect required
    startPoolAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
