import { SystemRole } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email?: string;
  UserRole?: Array<{ role?: { name?: SystemRole | string } }>;
};
