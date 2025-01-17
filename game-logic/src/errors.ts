import { PaimaMiddlewareErrorCode } from 'paima-sdk/paima-mw-core';

export enum MiddlewareErrorCode {
  GENERIC_ERROR = PaimaMiddlewareErrorCode.FINAL_PAIMA_GENERIC_ERROR + 1,
  // Query endpoint related:
  CALCULATED_ROUND_END_IN_PAST,
  UNABLE_TO_BUILD_EXECUTOR,
  NO_OPEN_LOBBIES,
  // Write endpoint related:
  FAILURE_VERIFYING_LOBBY_CREATION,
  FAILURE_VERIFYING_LOBBY_CLOSE,
  FAILURE_VERIFYING_LOBBY_JOIN,
  CANNOT_JOIN_OWN_LOBBY,
  CANNOT_CLOSE_SOMEONES_LOBBY,
  SUBMIT_MOVES_INVALID_MOVES,
}
