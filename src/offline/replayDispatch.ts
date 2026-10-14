export class ReplayDispatchSkipped extends Error {
  constructor() {
    super('REPLAY_DISPATCH_SKIPPED');
    this.name = 'ReplayDispatchSkipped';
  }
}

