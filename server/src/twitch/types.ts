export interface WatchStreak {
  displayName: string;
  login: string;
  streak: number;
  channelPoints: number | null;
  userMessage: string | null;
}

export interface ChatMessage {
  userId: string;
  login: string;
  displayName: string;
  text: string;
  isMod: boolean;
  isBroadcaster: boolean;
  isSubscriber: boolean;
}

export interface Raid {
  login: string;
  displayName: string;
  viewers: number;
}

export type SubTier = 1 | 2 | 3;

export interface GiftSub {
  gifterLogin: string | null;
  gifterName: string;
  amount: number;
  tier: SubTier;
  recipientName: string | null;
  senderTotal: number | null;
}

export interface Sub {
  login: string;
  displayName: string;
  months: number;
  firstTime: boolean;
  tier: SubTier;
  prime: boolean;
  userMessage: string | null;
}

export interface Cheer {
  login: string;
  displayName: string;
  bits: number;
}

export interface StreamInfo {
  sessionId: number;
  startedAt: number;
}

export type HubEvents = {
  watchStreak: [WatchStreak];
  raid: [Raid];
  sub: [Sub];
  giftSub: [GiftSub];
  chat: [ChatMessage];
  cheer: [Cheer];
  streamOnline: [StreamInfo];
  streamOffline: [StreamInfo];
  status: [boolean];
};
