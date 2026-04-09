import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  PlatformConnection,
  UnifiedCampaign,
  UnifiedMetrics,
  AnomalyAlert,
} from '../models/adops.js';

class AsyncLock {
  private queue: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queue;
    let resolve: () => void;
    this.queue = new Promise<void>((r) => (resolve = r));
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }
}

/** JSON file-based storage with AsyncLock for concurrent write protection. Supports optional custom data directory for test isolation. */
export class Storage {
  private readonly dataDir: string;
  private readonly connectionsPath: string;
  private readonly campaignsPath: string;
  private readonly metricsPath: string;
  private readonly alertsPath: string;
  private readonly lock = new AsyncLock();
  private initialized = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? path.join(process.cwd(), 'data');
    this.connectionsPath = path.join(this.dataDir, 'connections.json');
    this.campaignsPath = path.join(this.dataDir, 'campaigns.json');
    this.metricsPath = path.join(this.dataDir, 'metrics.json');
    this.alertsPath = path.join(this.dataDir, 'alerts.json');
  }

  private initPromise: Promise<void> | null = null;

  private async init(): Promise<void> {
    if (this.initialized) return;
    // Prevent concurrent init calls from racing
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    for (const [p, def] of [
      [this.connectionsPath, '[]'],
      [this.campaignsPath, '[]'],
      [this.metricsPath, '[]'],
      [this.alertsPath, '[]'],
    ] as const) {
      try {
        await fs.access(p);
      } catch {
        await fs.writeFile(p, def, 'utf-8');
      }
    }
    this.initialized = true;
  }

  private async read<T>(filePath: string): Promise<T> {
    await this.init();
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  private async write<T>(filePath: string, data: T): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Connections ───────────────────────────────────────────────────

  async getAllConnections(): Promise<PlatformConnection[]> {
    return this.read<PlatformConnection[]>(this.connectionsPath);
  }

  async getConnectionById(id: string): Promise<PlatformConnection | null> {
    const conns = await this.read<PlatformConnection[]>(this.connectionsPath);
    return conns.find((c) => c.id === id) ?? null;
  }

  async getConnectionsByPlatform(platform: string): Promise<PlatformConnection[]> {
    const conns = await this.read<PlatformConnection[]>(this.connectionsPath);
    return conns.filter((c) => c.platform === platform);
  }

  async addConnection(conn: PlatformConnection): Promise<PlatformConnection> {
    return this.lock.run(async () => {
      const conns = await this.read<PlatformConnection[]>(this.connectionsPath);
      conns.push(conn);
      await this.write(this.connectionsPath, conns);
      return conn;
    });
  }

  async updateConnection(id: string, updates: Partial<PlatformConnection>): Promise<PlatformConnection | null> {
    return this.lock.run(async () => {
      const conns = await this.read<PlatformConnection[]>(this.connectionsPath);
      const idx = conns.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      conns[idx] = { ...conns[idx], ...updates };
      await this.write(this.connectionsPath, conns);
      return conns[idx];
    });
  }

  // ── Campaigns ─────────────────────────────────────────────────────

  async getAllCampaigns(): Promise<UnifiedCampaign[]> {
    return this.read<UnifiedCampaign[]>(this.campaignsPath);
  }

  async getCampaignById(id: string): Promise<UnifiedCampaign | null> {
    const campaigns = await this.read<UnifiedCampaign[]>(this.campaignsPath);
    return campaigns.find((c) => c.id === id) ?? null;
  }

  async addCampaign(campaign: UnifiedCampaign): Promise<UnifiedCampaign> {
    return this.lock.run(async () => {
      const campaigns = await this.read<UnifiedCampaign[]>(this.campaignsPath);
      campaigns.push(campaign);
      await this.write(this.campaignsPath, campaigns);
      return campaign;
    });
  }

  async updateCampaign(id: string, updates: Partial<UnifiedCampaign>): Promise<UnifiedCampaign | null> {
    return this.lock.run(async () => {
      const campaigns = await this.read<UnifiedCampaign[]>(this.campaignsPath);
      const idx = campaigns.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      campaigns[idx] = { ...campaigns[idx], ...updates, updated_at: new Date().toISOString() };
      await this.write(this.campaignsPath, campaigns);
      return campaigns[idx];
    });
  }

  async searchCampaigns(filters: {
    platform?: string;
    status?: string;
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ campaigns: UnifiedCampaign[]; total: number }> {
    let campaigns = await this.read<UnifiedCampaign[]>(this.campaignsPath);

    if (filters.platform) campaigns = campaigns.filter((c) => c.platform === filters.platform);
    if (filters.status) campaigns = campaigns.filter((c) => c.status === filters.status);
    if (filters.query) {
      const q = filters.query.toLowerCase();
      campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(q));
    }

    campaigns.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const total = campaigns.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 20;
    return { campaigns: campaigns.slice(offset, offset + limit), total };
  }

  // ── Metrics ───────────────────────────────────────────────────────

  async getAllMetrics(): Promise<UnifiedMetrics[]> {
    return this.read<UnifiedMetrics[]>(this.metricsPath);
  }

  async getMetricsByCampaign(campaignId: string): Promise<UnifiedMetrics[]> {
    const metrics = await this.read<UnifiedMetrics[]>(this.metricsPath);
    return metrics.filter((m) => m.campaign_id === campaignId);
  }

  async getMetricsByDateRange(start: string, end: string, platform?: string): Promise<UnifiedMetrics[]> {
    const metrics = await this.read<UnifiedMetrics[]>(this.metricsPath);
    return metrics.filter((m) => {
      if (m.date < start || m.date > end) return false;
      if (platform && m.platform !== platform) return false;
      return true;
    });
  }

  async addMetrics(entry: UnifiedMetrics): Promise<UnifiedMetrics> {
    return this.lock.run(async () => {
      const metrics = await this.read<UnifiedMetrics[]>(this.metricsPath);
      metrics.push(entry);
      await this.write(this.metricsPath, metrics);
      return entry;
    });
  }

  async addMetricsBatch(entries: UnifiedMetrics[]): Promise<number> {
    return this.lock.run(async () => {
      const metrics = await this.read<UnifiedMetrics[]>(this.metricsPath);
      metrics.push(...entries);
      await this.write(this.metricsPath, metrics);
      return entries.length;
    });
  }

  // ── Alerts ────────────────────────────────────────────────────────

  async getAllAlerts(): Promise<AnomalyAlert[]> {
    return this.read<AnomalyAlert[]>(this.alertsPath);
  }

  async addAlert(alert: AnomalyAlert): Promise<AnomalyAlert> {
    return this.lock.run(async () => {
      const alerts = await this.read<AnomalyAlert[]>(this.alertsPath);
      alerts.push(alert);
      await this.write(this.alertsPath, alerts);
      return alert;
    });
  }

  async getRecentAlerts(limit: number = 20): Promise<AnomalyAlert[]> {
    const alerts = await this.read<AnomalyAlert[]>(this.alertsPath);
    return alerts
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
      .slice(0, limit);
  }
}

/** Default global storage instance using process.cwd()/data directory. */
export const storage = new Storage();
