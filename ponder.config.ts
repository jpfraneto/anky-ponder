import { createConfig } from "ponder";
import { http } from "viem";

import { AnkyFramesgivingAbi } from "./abis/AnkyFramesgivingAbi";

export default createConfig({
  networks: {
    degen: {
      chainId: 666666666,
      transport: http(process.env.PONDER_RPC_URL_666666666),
    },
  },
  contracts: {
    AnkyFramesgiving: {
      abi: AnkyFramesgivingAbi,
      address: "0xBc25EA092e9BEd151FD1947eE1Cf957cfdd580ef",
      network: "degen",
      startBlock: 24905511, // Add the block number where the contract was deployed
    },
  },
});
