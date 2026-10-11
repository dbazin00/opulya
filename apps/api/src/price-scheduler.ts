import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { MarketPriceSync } from "./instruments.js";

@Injectable()
export class PriceScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private active?: Promise<unknown>;
  private requested = false;
  constructor(
    @Inject(MarketPriceSync) private readonly sync: MarketPriceSync,
  ) {}
  onModuleInit() {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.MARKET_SCHEDULER_ENABLED === "false"
    )
      return;
    this.timer = setTimeout(() => void this.tick(), 1000);
    this.timer.unref();
  }
  requestRefresh() {
    if (
      this.stopped ||
      process.env.NODE_ENV === "test" ||
      !process.env.ALPHA_VANTAGE_API_KEY?.trim()
    )
      return;
    if (this.active) {
      this.requested = true;
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), 50);
    this.timer.unref();
  }
  private async tick() {
    if (this.stopped) return;
    this.requested = false;
    this.active = this.sync
      .run()
      .catch(() => console.warn("Daily price sync failed; retry scheduled"));
    await this.active;
    this.active = undefined;
    if (!this.stopped) {
      if (this.requested) {
        this.requestRefresh();
        return;
      }
      if (process.env.MARKET_SCHEDULER_ENABLED === "false") return;
      this.timer = setTimeout(() => void this.tick(), 60000);
      this.timer.unref();
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
