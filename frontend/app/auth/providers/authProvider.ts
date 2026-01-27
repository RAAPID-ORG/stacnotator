export interface AuthProvider {
  readonly id: string;
  login(email?: string, password?: string): Promise<string>;
  logout(): Promise<void>;
  isAuthenticated(): boolean;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  onAuthStateChanged(callback: (loggedIn: boolean) => void): () => void;
  register?(email: string, password: string): Promise<string>;
}
