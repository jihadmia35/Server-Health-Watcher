export interface User {
  id: string;
  email: string;
  password?: string;
}

export interface PollingResult {
  timestamp: string;
  responseTime: number;
  status: 'online' | 'offline';
}

export interface Server {
  id: string;
  userId: string;
  name: string;
  url: string;
  interval: number; // in minutes
  createdAt: string;
}

export interface ServerHistory {
  [serverId: string]: PollingResult[];
}

export type Theme = 'light' | 'dark';
