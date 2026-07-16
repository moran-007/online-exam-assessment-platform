export interface RequestUser {
  id: string;
  username: string;
  realName: string | null;
  userType: string;
  roles: string[];
  permissions: string[];
  mustChangePassword?: boolean;
}
