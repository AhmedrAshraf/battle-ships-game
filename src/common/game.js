const {
  StateMachine,
  transitionTo,
  getState,
  STATES,
  STARTING_STATE
} = require("../common/state-machine");
const { getNextId } = require("./id-generator");
const { Observer } = require("./observer");
const { Board } = require("./board");
const { ShootResult } = require("./constants.js");

const States = {
  IDLE: "idle",
  AWAITING_PLAYER: "awaiting",
  AWAITING_START: "awaitingStart",
  PLAYER_TURN: "playerTurn",
  FINISHED: "finished",
  DESTROYED: "destroyed"
};

exports.States = States;

function createGame() {
  return StateMachine({
    playerA: null,
    playerB: null,
    boards: new Map(),
    current: null,
    waiting: null,

    switchPlayer() {
      [this.current, this.waiting] = [this.waiting, this.current];
    },

    [STARTING_STATE]: States.IDLE,
    [STATES]: {
      [States.IDLE]: {
        initialize: transitionTo(States.AWAITING_PLAYER, function (playerA) {
          this.playerA = playerA;
          this.boards.set(playerA, new Board());
        })
      },
      [States.AWAITING_PLAYER]: {
        join: transitionTo(States.AWAITING_START, function (playerB) {
          this.playerB = playerB;
          this.boards.set(playerB, new Board());
        }),
        destroy: transitionTo(States.DESTROYED, function () {}),
        leave: transitionTo(States.DESTROYED, function () {})
      },
      [States.AWAITING_START]: {
        leave: transitionTo(States.AWAITING_PLAYER, function (player) {
          if (player === this.playerA) {
            this.playerA = null;
          } else if (player === this.playerB) {
            this.playerB = null;
          } else {
            throw Error(`Player with ${player.id} is not in a game`);
          }
        }),
        start: transitionTo(States.PLAYER_TURN, function () {
          this.current = this.playerA;
          this.waiting = this.playerB;
        }),
        destroy: transitionTo(States.DESTROYED, function () {})
      },

      [States.PLAYER_TURN]: {
        makeShot: transitionTo(function (player, position) {
          if (player !== this.current) {
            throw new Error("Player can't act during other player turn");
          }

          const board = this.boards.get(this.waiting);
          const result = board.processShoot(position);

          if (board.isAllShipsDestroyed()) {
            return States.FINISHED;
          }

          if (result === ShootResult.MISS) {
            this.switchPlayer();
          }

          return States.PLAYER_TURN;
        }),
        destroy: transitionTo(States.DESTROYED, function () {}),
        leave: transitionTo(States.DESTROYED, function () {})
      },
      [States.FINISHED]: {},
      [States.DESTROYED]: {}
    }
  });
}

exports.Game = class Game extends Observer {
  constructor(owner) {
    super();
    this._id = getNextId("game");
    this._owner = owner;
    this._machine = createGame();
    this._machine.initialize(owner);
    this._machine.onStateTransition = () => {
      this._notify("update", this.getGameState());
    };
  }

  getId() {
    return this._id;
  }

  getOwnerInfo() {
    return this._owner?.getInfo() ?? null;
  }

  getInfo() {
    return {
      id: this.getId(),
      owner: this.getOwnerInfo(),
      state: this.getState()
    };
  }

  getState() {
    return getState(this._machine);
  }

  isOver() {
    return (
      this.getGameState() === States.DESTROYED ||
      this.getGameState() === States.FINISHED
    );
  }

  initialize() {
    this._machine.initialize(this._owner);
  }

  start() {
    this._machine.start();
  }

  join(player) {
    const { playerA, playerB } = this._machine;
    if (player === playerA || player === playerB) {
      return;
    }

    this._machine.join(player);
  }

  leave(player) {
    if (player === this._owner) {
      this._machine.destroy();
      this._owner = null;
    } else {
      this._machine.leave(player);
      if (this.getState() === States.DESTROYED) {
        this._owner = null;
      }
    }
  }

  makeShot(player, target) {
    this._machine.makeShot(player, target);
    // TODO: check game over
  }

  destroy() {
    this._machine.destroy();
  }

  getCurrentPlayer() {
    return this._machine.current;
  }

  getWaitingPlayer() {
    return this._machine.waiting;
  }

  getBoard(player) {
    return this._machine.boards.get(player);
  }

  getGameState() {
    const current = this.getCurrentPlayer();
    const waiting = this.getWaitingPlayer();
    const currentBoard = this.getBoard(current);
    const waitingBoard = this.getBoard(waiting);
    const winnerId =
      waitingBoard?.isAllShipsDestroyed() ?? false ? current.getId() : null;

    return {
      id: this.getId(),
      state: this.getState(),
      winnerId,
      current: current?.getInfo() ?? null,
      waiting: waiting?.getInfo() ?? null,
      ownBoard: currentBoard?.getSnapshoot() ?? null,
      enemyBoard: waitingBoard?.getPublicSnapshoot() ?? null
    };
  }
};
