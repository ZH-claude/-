import { Session, User, UserGroup, Wallet } from '../generated/prisma/client';

export type AuthenticatedUser = User & {
  group: UserGroup;
  wallet: Wallet | null;
};

export type AuthContext = {
  session: Session;
  user: AuthenticatedUser;
};

export type AuthenticatedRequest = {
  auth?: AuthContext;
  headers: {
    authorization?: string;
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};
