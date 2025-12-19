export type UserRole = 'admin' | 'supervisor' | 'operador' | 'ativador';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  segmentId?: string;
  lineId?: string;
  isOnline: boolean;
  avatar?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
