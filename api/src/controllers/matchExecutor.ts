import { Controller, Get, Query, Route, ValidateError } from 'tsoa';
import { requirePool, getLobbyById, getMatchSeeds, getLobbyPlayers } from '@dice/db';
import {
  deserializeDeck,
  deserializeHand,
  deserializeMove,
  isLobbyWithStateProps,
  type LobbyPlayer,
  type MatchExecutorData,
} from '@dice/game-logic';
import { psqlInt } from '../validation';
import { isLeft } from 'fp-ts/lib/Either';
import { getMatch, getMatchMoves } from '@dice/db/src/select.queries';
import { getBlockHeight } from 'paima-sdk/paima-db';

type Response = MatchExecutorData | null;

@Route('match_executor')
export class MatchExecutorController extends Controller {
  @Get()
  public async get(@Query() lobbyID: string, @Query() matchWithinLobby: number): Promise<Response> {
    const valMatch = psqlInt.decode(matchWithinLobby);
    if (isLeft(valMatch)) {
      throw new ValidateError({ round: { message: 'invalid number' } }, '');
    }

    const pool = requirePool();
    const [lobby] = await getLobbyById.run({ lobby_id: lobbyID }, pool);
    const [match] = await getMatch.run(
      { lobby_id: lobbyID, match_within_lobby: matchWithinLobby },
      pool
    );
    const rawPlayers = await getLobbyPlayers.run({ lobby_id: lobbyID }, pool);
    if (lobby == null || !isLobbyWithStateProps(lobby) || match == null) {
      return null;
    }
    const players: LobbyPlayer[] = rawPlayers.map(raw => ({
      nftId: raw.nft_id,
      startingDeck: deserializeDeck(raw.starting_deck),
      currentDeck: deserializeDeck(raw.current_deck),
      currentHand: deserializeHand(raw.current_hand),
      currentDraw: raw.current_draw,
      points: raw.points,
      score: raw.score,
      turn: raw.turn ?? undefined,
    }));

    const txEventMove =
      lobby.current_tx_event_move == null
        ? undefined
        : deserializeMove(lobby.current_tx_event_move);

    const [initialSeed] = await getBlockHeight.run(
      { block_height: match.starting_block_height },
      pool
    );
    const matchSeeds = await getMatchSeeds.run(
      { lobby_id: lobbyID, match_within_lobby: matchWithinLobby },
      pool
    );
    const seeds = matchSeeds.map((seed, i) => ({
      seed: i === 0 ? initialSeed.seed : matchSeeds[i - 1].seed,
      block_height: seed.block_height,
      round: seed.round_within_match,
    }));

    const moves = await getMatchMoves.run(
      { lobby_id: lobbyID, match_within_lobby: matchWithinLobby },
      pool
    );

    return {
      lobby: {
        ...lobby,
        roundSeed: initialSeed.seed,
        players,
        txEventMove,
      },
      seeds,
      moves,
    };
  }
}
