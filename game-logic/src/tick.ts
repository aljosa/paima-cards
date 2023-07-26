import type Prando from 'paima-sdk/paima-prando';
import type {
  ApplyPointsTickEvent,
  MatchEndTickEvent,
  RoundEndTickEvent,
  TurnEndTickEvent,
  MatchState,
  MatchEnvironment,
  TickEvent,
  PostTxTickEvent,
  TxTickEvent,
  PlayCardTickEvent,
  DestroyCardTickEvent,
} from './types';
import { CARD_REGISTRY, MOVE_KIND, TICK_EVENT_KIND } from './constants';
import { deserializeMove, getNonTurnPlayer, getTurnPlayer, matchResults } from '.';
import type { IGetRoundMovesResult } from '@dice/db';
import { genPostTxEvents } from './cards-logic';

// TODO: variable number of players
const numPlayers = 2;

// Executes a round executor tick and generates a tick event as a result
export function processTick(
  matchEnvironment: MatchEnvironment,
  matchState: MatchState,
  // TODO: type for round and match moves is the same, not sure which is provided here
  moves: IGetRoundMovesResult[],
  currentTick: number,
  randomnessGenerator: Prando
): TickEvent[] | null {
  const events: TickEvent[] = [];
  // Every tick we intend to process a single move.
  const rawMove = moves[currentTick - 1];

  // Round ends (by returning null) if no more moves in round or game is finished.
  // This is nearly identical to writing a recursive function, where you want to check
  // the base/halt case before running the rest of the logic.
  if (!rawMove) return null;
  const move = deserializeMove(rawMove.serialized_move);

  // If a move does exist, we continue processing the tick by generating the event.
  // Required for frontend visualization and applying match state updates.
  const postTxEvents: PostTxTickEvent[] = genPostTxEvents(matchState, randomnessGenerator);

  // We then call `applyEvents` to mutate the `matchState` based off of the event.
  for (const event of postTxEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const playCardEvents: PlayCardTickEvent[] =
    move.kind === MOVE_KIND.playCard
      ? [
          {
            kind: TICK_EVENT_KIND.playCard,
            handPosition: move.handPosition,
            newHand: getTurnPlayer(matchState).currentHand.filter(
              (_, i) => i !== move.handPosition
            ),
            newBoard: [
              ...getTurnPlayer(matchState).currentBoard,
              {
                index: move.cardIndex,
                cardId: move.cardId,
              },
            ],
          },
        ]
      : [];
  // We then call `applyEvents` to mutate the `matchState` based off of the event.
  for (const event of playCardEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const destroyCardEvents: DestroyCardTickEvent[] = (() => {
    if (move.kind !== MOVE_KIND.targetCardWithBoardCard) return [];
    const turnPlayer = getTurnPlayer(matchState);
    const nonTurnPlayer = getNonTurnPlayer(matchState);
    const fromCardId = turnPlayer.currentBoard[move.fromBoardPosition]?.cardId;
    const toCardId = nonTurnPlayer.currentBoard[move.toBoardPosition]?.cardId;
    if (fromCardId == null || toCardId == null) return [];
    const fromCard = CARD_REGISTRY[fromCardId];
    if (fromCard == null) return [];
    if (fromCard.defeats !== toCardId) return [];
    return [
      {
        kind: TICK_EVENT_KIND.destroyCard,
        fromBoardPosition: move.fromBoardPosition,
        toBoardPosition: move.toBoardPosition,
        newFromBoard: turnPlayer.currentBoard.filter((_, i) => i !== move.fromBoardPosition),
        newToBoard: nonTurnPlayer.currentBoard.filter((_, i) => i !== move.toBoardPosition),
      },
    ];
  })();
  for (const event of destroyCardEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const turnEnds = move.kind === MOVE_KIND.endTurn;
  const roundEnds = turnEnds && matchState.turn === numPlayers - 1;
  const matchEnds = roundEnds && matchState.properRound === matchEnvironment.numberOfRounds - 1;

  const applyPointsEvents: ApplyPointsTickEvent[] = (() => {
    if (!roundEnds) return [];

    // rules:
    // Anyone who scored 21 gets 2 points.
    // If nobody scored 21:
    //   Over 21 gets 0 points.
    //   Closest to 21 gets 1 point, but tie is 0 points.

    const points = (() => {
      // replace going over 21 with -1 score, simplifies logic
      const scores = matchState.players.map(player => (player.score > 21 ? -1 : player.score));
      const someoneScored21 = scores.some(score => score === 21);
      if (someoneScored21) {
        return scores.map(score => (score === 21 ? 2 : 0));
      } else {
        const max = Math.max(...scores);

        if (scores.filter(value => value === max).length > 1) return scores.map(() => 0);

        return scores.map(score => (score === max ? 1 : 0));
      }
    })();

    return [
      {
        kind: TICK_EVENT_KIND.applyPoints,
        points,
      },
    ];
  })();
  for (const event of applyPointsEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const turnEndEvents: TurnEndTickEvent[] = turnEnds ? [{ kind: TICK_EVENT_KIND.turnEnd }] : [];
  for (const event of turnEndEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const roundEndEvents: RoundEndTickEvent[] = roundEnds ? [{ kind: TICK_EVENT_KIND.roundEnd }] : [];
  for (const event of roundEndEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  const matchEndEvents: MatchEndTickEvent[] = matchEnds
    ? [{ kind: TICK_EVENT_KIND.matchEnd, result: matchResults(matchState) }]
    : [];
  for (const event of matchEndEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  // Note: In this game, move === round. If there were multiple moves per tx round, this wouldn't always happen.
  const txEvents: TxTickEvent[] = [{ kind: TICK_EVENT_KIND.tx, move }];
  for (const event of txEvents) {
    applyEvent(matchState, event);
    events.push(event);
  }

  // We return the tick event which gets emitted by the round executor. This is explicitly
  // for the frontend to know what happened during the current tick.
  return events;
}

// Apply events to match state for the roundExecutor.
export function applyEvent(matchState: MatchState, event: TickEvent): void {
  if (event.kind === TICK_EVENT_KIND.postTx) {
    const turnPlayerIndex = matchState.players.findIndex(player => player.turn === matchState.turn);
    matchState.players[turnPlayerIndex].currentDraw++;
    matchState.players[turnPlayerIndex].currentDeck = event.draw.newDeck;
    matchState.players[turnPlayerIndex].currentHand.push(event.draw.card);
    return;
  }

  if (event.kind === TICK_EVENT_KIND.playCard) {
    const turnPlayerIndex = matchState.players.findIndex(player => player.turn === matchState.turn);
    matchState.players[turnPlayerIndex].currentHand = event.newHand;
    matchState.players[turnPlayerIndex].currentBoard = event.newBoard;
  }

  if (event.kind === TICK_EVENT_KIND.destroyCard) {
    const turnPlayerIndex = matchState.players.findIndex(player => player.turn === matchState.turn);
    const nonTurnPlayerIndex = matchState.players.findIndex(
      player => player.turn !== matchState.turn
    );
    matchState.players[turnPlayerIndex].currentBoard = event.newFromBoard;
    matchState.players[nonTurnPlayerIndex].currentBoard = event.newToBoard;
  }

  if (event.kind === TICK_EVENT_KIND.applyPoints) {
    for (const i in matchState.players) {
      matchState.players[i].points += event.points[i];
    }
  }

  if (event.kind === TICK_EVENT_KIND.turnEnd) {
    matchState.turn = (matchState.turn + 1) % numPlayers;
    return;
  }

  if (event.kind === TICK_EVENT_KIND.roundEnd) {
    matchState.properRound++;
    for (const i in matchState.players) {
      matchState.players[i].score = 0;
    }
  }

  if (event.kind === TICK_EVENT_KIND.matchEnd) {
    matchState.result = event.result;
  }

  if (event.kind === TICK_EVENT_KIND.tx) {
    matchState.txEventMove = event.move;
  }
}
