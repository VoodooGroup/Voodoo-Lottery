# Voodoo Lottery

PulseChain lottery dApp with the same dual-wallet header as **StakingPlatform-V4**.

## Run

Double-click **`START.bat`** → open **http://127.0.0.1:8080/**  
(Keep the black window open.)

## Header buttons

| Button | Action |
|--------|--------|
| **Voodoo Wallet** | Connect Voodoo browser extension (EIP-1193 / EIP-6963) |
| **Other** | RainbowKit modal (MetaMask, WalletConnect, Rabby, …) |

Only one wallet kind is active at a time. No auto-connect on load.

## Flow

1. Connect with **Voodoo Wallet** or **Other** (PulseChain 369)
2. **Approve** VDO for the lottery contract
3. **Buy** Bronze / Silver / Gold / Diamond ticket

## Files

```
public/
  index.html
  css/lottery.css
  js/
    config.js           # addresses + ABIs
    wallet.js           # dual connect (from staking)
    ui.js               # in-dapp modals
    app.js              # buttons + lottery logic
    rainbow-bridge.js   # Other wallets
  favicon.png
  voodoo-token-background-2.png
server.js / START.bat
```

## Contracts

- Lottery: `0x560B17793300d5C27Dc2dFbedd09740edBB2d35b`
- VDO: `0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00`
