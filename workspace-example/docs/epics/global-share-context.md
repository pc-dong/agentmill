# 全局共享上下文（Cross-Epic）

> 文档类型：Global Shared Context  
> 路径：`docs/epics/global-share-context.md`  
> 版本：v0.1  
> 日期：2026-01-01  
> 体系说明：`docs/README-PRD体系.md`  
> 模版：`docs/template/GLOBAL-共享上下文模版.md`

> **用途**：记录**跨多个 Epic** 复用的业务术语、已有能力与边界约定。  
> 各 Epic 的 `shared-context.md` **只引用、不重新定义**本文已登记内容。  
> 冲突时：**本文优先于**各 Epic `shared-context.md` 中对同一术语/对象的描述。

---

## 1. 使用约定

| 规则 | 说明 |
|------|------|
| 何时写入本文 | 术语/对象被 ≥2 个 Epic 使用，或属平台已有能力（非本 Epic 新建主数据） |
| 何时写在 Epic `shared-context.md` | 仅本 Epic 使用的术语、权限码、对象、E-R 约束 |
| PRD / TECH-DESIGN | 引用 `docs/epics/global-share-context.md` + 本 Epic `shared-context.md`；禁止另起同义英文名 |
| 编号 | 跨 Epic 约束用 `G-R-xxx`；Epic 内仍用 `E-R-xxx` |

---

## 2. 跨 Epic 术语表

### 2.1 优惠券域（已有能力，示例）

> 平台已有券能力；活动页、组队等 Epic（示例） **引用**批次，**不在本域重建**优惠券主数据。  
> 代码侧常见类型：`com.example.common.coupon.CouponStock`、`CouponStockRef` 等。  
> 历史文档若写 `CouponBatch` / `couponBatchId`，语义等同 `CouponStock` **/** `couponStockId`，新文档一律用后者。

| 术语 | 术语英文 | 定义 | 备注 |
|------|---------|------|------|
| 优惠券批次 | CouponStock | 可发放的一类优惠券的**批次/库存配置**主数据：面额规则、库存、有效期、适用条件等 | **已有能力**；运营在券管理中创建/维护；其他业务只**选择引用** |
| 优惠券 | Coupon | 用户侧持有的**单张**券实例（由某 `CouponStock` 发放产生） | **已有能力**；领取/核销在券域；落地页配置一般不直接配置 Coupon |
| 优惠券领取位 | CouponClaimSlot | 活动页 / 落地页领取展位；持有对 `CouponStock` 的引用（经 `coupon_claim_slot_stock`） | **已有能力**（表 `coupon_claim_slot*`）；活动页 Epic（示例）中由 `CouponClaimSlotModule` **包含**一个 ClaimSlot；applied 关联表以 `campaign_type` 字段区分活动类型（示例）；≠ Coupon / CouponStock |
| 批次引用 | CouponStockRef | 他域配置中对 `CouponStock` 的引用值对象（通常含 stockId/批次号等） | 活动页领取位（示例）、组队奖池等均通过 Ref 关联 |

**关系（概念）**

```text
CouponStock（批次主数据，1）
    └── 发放产生 → Coupon（用户实例，N）

CouponClaimSlot（领取位配置）
    └── 引用 → CouponStockRef → CouponStock（1..N，视单券/券包模板）
```

**易混对照**

| 说法 | 正确对象 | 错误用法 |
|------|---------|---------|
| 「选一个批次」 | 选择 `CouponStock` | 说成创建 Coupon / 创建领取位主数据 |
| 「用户领到一张券」 | 得到 `Coupon` 实例 | 把 CouponStock 当成用户持券 |
| 「页面上的领券模块」 | `CouponClaimSlot` | 与 CouponStock 混称「批次模块」 |

---

## 3. 跨 Epic 业务对象（摘要）

| 业务对象 | 英文 | 所属能力域 | 他域如何使用 |
|----------|------|-----------|-------------|
| 优惠券批次 | CouponStock | 券域（已有） | 只读查询 / 选择；校验存在与可用 |
| 优惠券 | Coupon | 券域（已有） | 领取、查询持券；活动配置一般不写 |
| 优惠券领取位 | CouponClaimSlot | 营销展示/模块（已有能力） | 活动页 Epic（示例）：模块包含 ClaimSlot；applied 关联表写 `campaign_type`（示例） |
| 订阅配置 | SubscriptionConfig | 可复用订阅（channel + related_uuid） | 示例：内容/活动聚合 related_uuid=<aggregate>.uuid |
| 批次引用 | CouponStockRef | 值对象（跨域） | 嵌入活动/模块配置，不复制批次主数据 |

---

## 4. 跨 Epic 约束

G-R-001：券主数据不落他域

- 适用：所有引用优惠券的 Epic / PRD / TECH-DESIGN
- 条件：配置领券、奖池、发放等
- 动作：仅持久化对 `CouponStock` 的引用（如 `CouponStockRef`）；**禁止**在引用方聚合内复制批次主数据字段作为第二套真相源；**禁止**在未走券域流程时「创建批次」。

G-R-002：术语英文名冻结

- 适用：全部规格与技术方案
- 条件：提及优惠券批次 / 券 / 领取位
- 动作：分别使用 `CouponStock` / `Coupon` / `CouponClaimSlot`；不得再用 `CouponBatch` 作为新文档正式英文名（存量历史文档迁移时等价替换说明即可）。

G-R-003：领取位 ≠ 批次 ≠ 用户券

- 适用：模块配置、C 端展示、发奖
- 条件：建模或接口命名
- 动作：三者不得合并为同一实体；接口字段名应可区分（如 `couponStockId` vs `couponId` vs 领取位 `module.uuid`）。

---

## 5. 变更记录

| 日期 | 版本 | 摘要 |
|------|------|------|
| 2026-01-01 | v0.1 | 初稿；登记优惠券域 CouponStock、Coupon、CouponClaimSlot |
