// 重新导出主要的drizzle函数和类型
export { drizzle, type SolidDatabase } from './driver';

type SolidInlineSessionOptions = {
  webId: string;
  fetch: typeof fetch;
  sessionId?: string;
};

type SolidInlineSessionInfo = {
  isLoggedIn: boolean;
  webId: string;
  sessionId: string;
};

type SolidInlineSession = {
  info: SolidInlineSessionInfo;
  fetch: typeof fetch;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  handleIncomingRedirect: () => Promise<void>;
};

const createInlineSession = (options: SolidInlineSessionOptions): SolidInlineSession => {
  const { webId, fetch: boundFetch } = options;

  if (typeof webId !== 'string' || webId.trim().length === 0) {
    throw new Error('solid() requires a valid Solid WebID.');
  }

  if (typeof boundFetch !== 'function') {
    throw new Error('solid() requires a valid fetch implementation.');
  }

  const sessionInfo: SolidInlineSessionInfo = {
    isLoggedIn: true,
    webId,
    sessionId: options.sessionId ?? `inline-${Date.now()}`
  };

  const noop = async (): Promise<void> => {
    return Promise.resolve();
  };

  return {
    info: sessionInfo,
    fetch: boundFetch,
    login: noop,
    logout: noop,
    handleIncomingRedirect: noop
  };
};

export const solid = (options: SolidInlineSessionOptions): SolidInlineSession => {
  return createInlineSession(options);
};

export type { SolidInlineSession, SolidInlineSessionInfo, SolidInlineSessionOptions };
