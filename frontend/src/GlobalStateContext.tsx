import type { SetStateAction } from "react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type MainController from "./MainController";
import { AppContext } from "./main";
import type { UseStateResponse } from "./utils";
import type { WalletAddress } from "paima-sdk/paima-utils";
import * as Paima from "@dice/middleware";
import ConnectingModal from "./ConnectingModal";
import { PaimaNotice, OasysNotice } from "./components/PaimaNotice";
import { Box } from "@mui/material";
import type { CardDbId, LocalCard } from "@dice/game-logic";
import type {
  IGetBoughtPacksResult,
  IGetCardsByIdsResult,
  IGetOwnedCardsResult,
  IGetTradeNftsResult,
} from "@dice/db/build/select.queries";
import LocalStorage from "./LocalStorage";

export const localDeckCache: Map<string, LocalCard[]> = new Map();

export type Collection = {
  /** emphasis on **bought**, user might not own all cards in them anymore */
  boughtPacks?: IGetBoughtPacksResult[];
  cards?: Record<CardDbId, IGetOwnedCardsResult>;
};

type GlobalState = {
  connectedWallet?: WalletAddress;
  selectedNftState: UseStateResponse<{
    loading: boolean;
    nft: undefined | number;
  }>;
  collection: Collection;
  selectedDeckState: UseStateResponse<undefined | CardDbId[]>;
  tradeNfts:
    | undefined
    | {
        tradeNfts: IGetTradeNftsResult[];
        cardLookup: Record<string, IGetCardsByIdsResult>;
      };
};

export const GlobalStateContext = createContext<GlobalState>(
  null as any as GlobalState
);

export function GlobalStateProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const mainController: MainController = useContext(AppContext) as any;
  const [connectedWallet, setConnectedWallet] = useState<
    undefined | WalletAddress
  >();
  const [selectedNft, setSelectedNft] = useState<{
    loading: boolean;
    nft: undefined | number;
  }>({
    loading: true,
    nft: undefined,
  });
  const [collection, setCollection] = useState<Collection>({});
  const [tradeNfts, setTradeNfts] = useState<
    | undefined
    | {
        tradeNfts: IGetTradeNftsResult[];
        cardLookup: Record<string, IGetCardsByIdsResult>;
      }
  >();

  const [selectedDeckSubscription, setSelectedDeckSubscription] =
    useState<number>(0);
  const selectedDeck = useMemo(() => {
    const result = LocalStorage._getSelectedDeck();
    if (
      collection.cards != null &&
      result?.some((card) => collection.cards?.[card] == null)
    ) {
      LocalStorage._setSelectedDeck(undefined);
      return undefined;
    }

    // Make this hook depend on selectedDeckSubscription.
    // Less likely to break stuff than ignoring the entire exhaustive hooks rule.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = selectedDeckSubscription;

    return result;
  }, [collection, selectedDeckSubscription]);
  const setSelectedDeck = useCallback(
    (cards: SetStateAction<undefined | CardDbId[]>) => {
      if (typeof cards === "function") {
        throw new Error(
          `setSelectedDeck: function set state action not supported`
        );
      }

      LocalStorage._setSelectedDeck(cards);
      setSelectedDeckSubscription((old) => old + 1);
    },
    []
  );

  useEffect(() => {
    // poll owned nfts
    const fetch = async () => {
      if (connectedWallet == null) return;

      const result = await Paima.default.getNftForWallet(connectedWallet);
      if (
        result.success &&
        (result.result == null || result.result !== selectedNft.nft)
      ) {
        setSelectedNft({
          loading: false,
          nft: result.result,
        });
      }
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [mainController, connectedWallet, selectedNft]);

  useEffect(() => {
    // poll collection
    const fetch = async () => {
      if (selectedNft.nft == null) return;

      Promise.all([
        (async () => {
          if (selectedNft.nft == null) return;

          const result = await Paima.default.getUserPacks(selectedNft.nft);
          if (result.success) {
            setCollection((oldCollection) => ({
              ...oldCollection,
              boughtPacks: result.result,
            }));
          }
        })(),
        (async () => {
          if (selectedNft.nft == null) return;

          const result = await Paima.default.getUserCards(selectedNft.nft);
          if (result.success) {
            const raw = result.result;
            const cards = Object.fromEntries(
              raw.map((entry) => [entry.id, entry])
            );

            setCollection((oldCollection) => ({
              ...oldCollection,
              cards,
            }));
          }
        })(),
      ]);
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [mainController, selectedNft]);

  useEffect(() => {
    // poll connection to wallet
    const fetch = async () => {
      const connectResult = await Paima.default.userWalletLogin("metamask");
      const newWallet = connectResult.success
        ? connectResult.result.walletAddress
        : undefined;
      setConnectedWallet(newWallet);
    };
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => clearInterval(interval);
  }, [connectedWallet, mainController]);

  useEffect(() => {
    // poll trade nfts
    const fetch = async () => {
      if (selectedNft.nft == null) return;

      const result = await Paima.default.getUserTradeNfts(selectedNft.nft);
      if (result.success) setTradeNfts(result.result);
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [selectedNft]);

  // if a user disconnects, we will suspend the pages the previously connected wallet
  // instead of setting connected wallet back to undefined
  const [lastConnectedWallet, setLastConnectedWallet] = useState<
    undefined | WalletAddress
  >();
  useEffect(() => {
    if (connectedWallet == null) return;

    setLastConnectedWallet(connectedWallet);
  }, [connectedWallet]);

  const value = useMemo<GlobalState>(
    () => ({
      connectedWallet: lastConnectedWallet,
      selectedNftState: [selectedNft, setSelectedNft],
      collection,
      selectedDeckState: [selectedDeck, setSelectedDeck],
      tradeNfts,
    }),
    [
      collection,
      lastConnectedWallet,
      selectedDeck,
      selectedNft,
      setSelectedDeck,
      tradeNfts,
    ]
  );

  return (
    <GlobalStateContext.Provider value={value}>
      <ConnectingModal open={connectedWallet == null} />
      {children}
      <PaimaNotice />
      <Box sx={{ marginRight: 1 }} />
      <OasysNotice />
    </GlobalStateContext.Provider>
  );
}

export const useGlobalStateContext = (): GlobalState => {
  const context = useContext(GlobalStateContext);
  if (context == null) {
    throw new Error(
      "useGlobalStateContext must be used within an GlobalStateProvider"
    );
  }
  return context;
};
