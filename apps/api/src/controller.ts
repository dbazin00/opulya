import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { filterSchema, z } from "@opulya/shared";
import { AuthGuard, type AuthRequest } from "./security.js";
import { Database } from "./db.js";
import { LedgerService } from "./ledger.js";
import { ReportsService } from "./reports.js";
import { BudgetsService } from "./budgets.js";
import {
  InstrumentDirectory,
  directorySchema,
} from "./instrument-directory.js";
import { InstrumentsService, selectInstrumentSchema } from "./instruments.js";

@Controller()
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(BudgetsService) private readonly budgets: BudgetsService,
    @Inject(InstrumentsService)
    private readonly instruments: InstrumentsService,
    @Inject(InstrumentDirectory)
    private readonly directory: InstrumentDirectory,
  ) {}
  @Get("budgets") budgetList(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.budgets.list(req.user.id, query, req.user.timeZone);
  }
  @Post("budgets") saveBudget(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.budgets.save(req.user.id, body);
  }
  @Delete("budgets/override") resetBudget(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.budgets.resetMonth(req.user.id, body);
  }
  @Get("accounts") async accounts(@Req() req: AuthRequest) {
    return (await this.ledger.all(req.user.id)).accounts;
  }
  @Post("accounts") async createAccount(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.ledger.createAccount(req.user.id, body);
  }
  @Patch("accounts/:id") async updateAccount(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.ledger.updateAccount(req.user.id, id, body);
  }
  @Delete("accounts/:id") deleteAccount(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.removeAccount(req.user.id, id);
  }
  @Post("accounts/:id/balance") adjustBalance(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.ledger.adjustBalance(req.user.id, id, body);
  }
  @Get("accounts/:id/history") history(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const parsed = filterSchema.parse(query);
    return this.ledger.history(
      req.user.id,
      id,
      parsed.month,
      req.user.timeZone,
    );
  }
  @Get("categories") categories(@Req() req: AuthRequest) {
    return this.db.category.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { transactions: true, budgets: true } } },
    });
  }
  @Post("categories") category(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.ledger.category(req.user.id, body);
  }
  @Patch("categories/:id") updateCategory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.ledger.category(req.user.id, body, id);
  }
  @Delete("categories/:id") deleteCategory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.removeCategory(req.user.id, id);
  }
  @Post("categories/:id/archive") archiveCategory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.archiveCategory(req.user.id, id, true);
  }
  @Post("categories/:id/restore") restoreCategory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.archiveCategory(req.user.id, id, false);
  }
  @Get("transactions") async transactions(
    @Req() req: AuthRequest,
    @Query() query: unknown,
  ) {
    const parsed = filterSchema.parse(query);
    const data = await this.ledger.all(req.user.id);
    return this.ledger.filter(
      data.transactions,
      data.categories,
      parsed,
      req.user.timeZone,
    );
  }
  @Get("transactions/:id") async transaction(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    const tx = await this.db.transaction.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!tx) throw new NotFoundException("NOT_FOUND");
    return tx;
  }
  @Post("transactions") createTransaction(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.ledger.createTransaction(req.user.id, body);
  }
  @Post("transactions/:id/void") voidTransaction(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.voidTransaction(req.user.id, id);
  }
  @Get("assets") async assets(@Req() req: AuthRequest) {
    const rows = await this.db.asset.findMany({
      where: { userId: req.user.id },
      orderBy: { symbol: "asc" },
      include: {
        _count: { select: { transactions: true } },
        instrument: {
          select: {
            symbol: true,
            exchangeName: true,
            mic: true,
            isin: true,
          },
        },
      },
    });
    return rows.map(({ _count, instrument, ...asset }) => ({
      ...asset,
      canDelete: _count.transactions === 0,
      sourceSymbol: instrument?.symbol ?? null,
      exchangeName: instrument?.exchangeName ?? null,
      mic: instrument?.mic ?? "",
      isin: instrument?.isin ?? null,
    }));
  }
  @Delete("assets/:id") deleteAsset(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.instruments.removeAsset(req.user.id, id);
  }
  @Get("assets/prices") assetPrices(@Req() req: AuthRequest) {
    return this.reports.assetPrices(req.user.id);
  }
  @Post("assets") async createAsset(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const selected = selectInstrumentSchema.parse(body);
    const asset = await this.instruments.select(
      req.user.id,
      await this.directory.resolve(selected.instrumentId),
    );
    return asset;
  }
  @Get("instruments/directory") directoryItems(
    @Req() req: AuthRequest,
    @Query() query: unknown,
  ) {
    return this.directory.browse(directorySchema.parse(query), req.user.id);
  }
  @Get("investments/:id") investmentDetails(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.ledger.investmentDetails(req.user.id, id);
  }
  @Post("investments") async investment(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const entry = await this.ledger.investment(req.user.id, body);
    return entry;
  }
  @Post("investments/:id/void") voidInvestment(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.ledger.voidInvestment(req.user.id, id);
  }
  @Get("accounts/:id/portfolio") portfolio(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    z.object({}).strict().parse(query);
    return this.reports.portfolio(req.user.id, id);
  }
  @Get("analytics") analytics(
    @Req() req: AuthRequest,
    @Query() query: unknown,
  ) {
    return this.reports.analytics(
      req.user.id,
      filterSchema.parse(query),
      req.user.timeZone,
    );
  }
  @Get("overview") overview(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.reports.overview(
      req.user.id,
      filterSchema.parse(query).currency,
    );
  }
}
