/**
 * Lottery + PulseChain config (required by wallet.js).
 */
window.VoodooConfig = {
  VDO_ADDRESS: '0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00',
  LOTTERY_ADDRESS: '0x560B17793300d5C27Dc2dFbedd09740edBB2d35b',
  PULSE_CHAIN_ID: 369,
  PULSECHAIN_NETWORK: {
    chainId: '0x171',
    chainName: 'PulseChain',
    nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
    rpcUrls: ['https://rpc.pulsechain.com'],
    blockExplorerUrls: ['https://scan.pulsechain.com'],
  },
  LOTTERY_ABI: [
    'function joinBronze() external',
    'function joinSilver() external',
    'function joinGold() external',
    'function joinDiamond() external',
    'function getBronzeStatus() external view returns (uint256 current, uint256 max, uint256 ticketPrice)',
    'function getSilverStatus() external view returns (uint256 current, uint256 max, uint256 ticketPrice)',
    'function getGoldStatus() external view returns (uint256 current, uint256 max, uint256 ticketPrice)',
    'function getDiamondStatus() external view returns (uint256 current, uint256 max, uint256 ticketPrice)',
  ],
  TOKEN_ABI: [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
  ],
};
