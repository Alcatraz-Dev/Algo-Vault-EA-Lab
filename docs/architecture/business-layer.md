# Business Layer Architecture

ERPNext / Frappe integrates as an additive business layer behind the AlgoVault API.

```
AlgoVault Frontend → AlgoVault API → Firebase / Stripe / Trading Core
                                    ↓
                              Business Sync Layer
                                    ↓
                              Frappe / ERPNext
```

Responsibilities: customers, developers, orders, invoices, payments, commissions, subscriptions, business audit.

Not responsible for: trading execution, AI execution, market intelligence, licensing runtime authorization.
