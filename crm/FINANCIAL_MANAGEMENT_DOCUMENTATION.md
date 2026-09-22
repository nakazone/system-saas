# 💰 Financial Management Module - Documentation

## 📋 Overview

Sistema completo de gestão financeira empresarial para empresa de pisos, incluindo:
- Job costing (custeio por projeto)
- Rastreamento centralizado de despesas
- Upload de recibos
- Integração com folha de pagamento
- Análise de lucro em tempo real
- Dashboard executivo

---

## 🗄️ Database Structure

### Tables Created

#### 1. **project_financials**
Financeiro por projeto com estimativas vs. real.

**Key Fields:**
- `estimated_revenue` / `actual_revenue` - Receita
- `estimated_material_cost` / `actual_material_cost` - Custo de material
- `estimated_labor_cost` / `actual_labor_cost` - Custo de mão de obra
- `estimated_overhead` / `actual_overhead` - Overhead
- `estimated_profit` / `actual_profit` - Lucro
- `profit_variance` - Variação de lucro (actual - estimated)
- `actual_margin_percentage` - Margem real (%)
- `is_locked` - Bloqueado quando projeto completado

#### 2. **expenses**
Despesas centralizadas.

**Key Fields:**
- `category` - material | labor | equipment | travel | office | other
- `project_id` - NULL = overhead geral
- `amount` / `tax_amount` / `total_amount` - Valores
- `status` - pending | approved | paid | rejected
- `receipt_url` / `receipt_file_path` - Upload de recibo
- `approved_by` / `approved_at` - Aprovação

#### 3. **receipts**
Recibos com extração OCR (preparado para futuro).

**Key Fields:**
- `expense_id` - FK expenses
- `file_url` / `file_path` - Arquivo do recibo
- `extracted_amount` / `extracted_vendor` / `extracted_date` - Dados extraídos (OCR)
- `verification_status` - pending | verified | rejected

#### 4. **payroll_entries**
Folha de pagamento.

**Key Fields:**
- `employee_id` - FK users
- `project_id` - NULL = overhead
- `crew_id` - FK crews
- `hours_worked` / `hourly_rate` - Horas e taxa
- `overtime_hours` / `overtime_cost` - Horas extras
- `total_cost` - Custo total
- `approved` - Aprovação necessária

#### 5. **financial_transactions**
Transações financeiras (histórico).

#### 6. **company_overhead_pool**
Pool de overhead geral por período.

### Schema File
Execute: `database/schema-financial-engine.sql`

---

## 🧮 Calculation Engine

### Core Functions (`services/financialCalculator.js`)

#### **calculateActualTotalCost(materialCost, laborCost, overhead)**
```
actual_total_cost = material_cost + labor_cost + overhead
```

#### **calculateActualProfit(revenue, totalCost)**
```
actual_profit = revenue - total_cost
```

#### **calculateMarginPercentage(revenue, profit)**
```
margin_percentage = (profit / revenue) × 100
```

#### **recalculateProjectFinancial(financial)**
Recalcula todos os valores:
- Custo total estimado e real
- Lucro estimado e real
- Margem estimada e real
- Todas as variações

#### **allocateExpense(pool, expenseId)**
Aloca despesa automaticamente:
- Se `project_id` existe → aloca para projeto
- Se `project_id` é NULL → aloca para overhead geral
- Baseado na categoria (material/labor/equipment)

#### **allocatePayroll(pool, payrollEntryId)**
Aloca payroll automaticamente:
- Se `project_id` existe → aloca como `actual_labor_cost`
- Se `project_id` é NULL → aloca para overhead pool

---

## 🔌 API Routes

### Base URLs: `/api/financial`, `/api/expenses`, `/api/payroll`

#### **GET /api/projects/:projectId/financial**
Obtém financial do projeto com análise em tempo real.

**Response:**
```json
{
  "success": true,
  "data": {
    "estimated_revenue": 15000,
    "actual_revenue": 14800,
    "estimated_profit": 3750,
    "actual_profit": 3600,
    "profit_variance": -150,
    "actual_margin_percentage": 24.3,
    "is_profitable": true
  }
}
```

#### **PUT /api/projects/:projectId/financial**
Atualiza financial do projeto.

**Body:**
```json
{
  "actual_revenue": 14800,
  "actual_material_cost": 8000,
  "actual_labor_cost": 3200,
  "actual_overhead": 0,
  "is_locked": false
}
```

#### **GET /api/expenses**
Lista despesas.

**Query Parameters:**
- `project_id` - Filtrar por projeto
- `category` - Filtrar por categoria
- `status` - Filtrar por status
- `start_date` / `end_date` - Filtrar por período

#### **POST /api/expenses**
Criar despesa.

**Body:**
```json
{
  "category": "material",
  "project_id": 1,
  "vendor": "ABC Supplies",
  "description": "Hardwood flooring materials",
  "amount": 5000,
  "tax_amount": 400,
  "payment_method": "credit_card",
  "expense_date": "2024-03-15",
  "receipt_url": "https://..."
}
```

#### **PUT /api/expenses/:id/approve**
Aprova despesa e aloca automaticamente.

#### **GET /api/payroll**
Lista entries de folha de pagamento.

#### **POST /api/payroll**
Criar entry de folha.

**Body:**
```json
{
  "employee_id": 5,
  "project_id": 1,
  "crew_id": 2,
  "date": "2024-03-15",
  "hours_worked": 8,
  "hourly_rate": 25.00,
  "overtime_hours": 2,
  "overtime_rate": 37.50
}
```

#### **PUT /api/payroll/:id/approve**
Aprova entry e aloca automaticamente.

#### **GET /api/financial/dashboard**
Dashboard financeiro completo.

**Response:**
```json
{
  "success": true,
  "data": {
    "revenue_vs_cost": {...},
    "expense_breakdown": [...],
    "monthly_cash_flow": [...],
    "profitability_ranking": [...],
    "crew_cost_analysis": [...]
  }
}
```

---

## 🎨 Frontend Interface

### Financial Page (`financial-engine.js`)

**Views Disponíveis:**

1. **Dashboard** 📊
   - Stats cards (Revenue, Cost, Profit, Margin)
   - Revenue vs Cost chart
   - Expense breakdown (doughnut)
   - Monthly cash flow (line)
   - Crew cost analysis (bar)
   - Project profitability ranking

2. **Expenses** 💰
   - Tabela de despesas
   - Filtros por projeto, categoria, status
   - Aprovação de despesas
   - Visualização de recibos

3. **Payroll** 👥
   - Tabela de entries
   - Filtros por employee, project, crew
   - Aprovação de entries
   - Cálculo automático de horas extras

**Modals:**
- New Expense - Criar despesa
- New Payroll Entry - Criar entry de folha

---

## 🔄 Workflow Rules

### 1. Despesas devem ser aprovadas
- Status inicial: `pending`
- Aprovação: `approved` → aloca automaticamente
- Pagamento: `paid` (opcional)
- Rejeição: `rejected` (não aloca)

### 2. Payroll deve ser aprovado
- Status inicial: `approved = 0`
- Aprovação: `approved = 1` → aloca automaticamente

### 3. Bloqueio quando projeto completado
- `is_locked = 1` → não permite mais alterações
- `locked_at` e `locked_by` registrados

---

## 📊 Dashboard Metrics

### Revenue vs Cost
- Compara estimado vs. real
- Gráfico de barras lado a lado

### Expense Breakdown
- Por categoria (material, labor, equipment, etc.)
- Gráfico doughnut

### Monthly Cash Flow
- Receita vs. Despesas por mês
- Gráfico de linha

### Crew Cost Analysis
- Custo total por equipe
- Horas trabalhadas

### Profitability Ranking
- Top 10 projetos por lucro
- Mostra margem e variação

---

## 🔒 Security & Roles

### Roles Implementados:
- **Admin** - Acesso total
- **Finance Manager** - Pode aprovar despesas/payroll
- **Project Manager** - Pode ver financial do projeto
- **Crew Member** - Acesso limitado (apenas visualização)

*Nota: Sistema de roles já existe em `users.role`, pode ser expandido.*

---

## 🚀 Setup Instructions

### 1. Database Setup

```bash
# Execute o schema
mysql -h [HOST] -u [USER] -p [DATABASE] < database/schema-financial-engine.sql

# Ou via Node.js
node database/run-schema-financial-engine.js
```

### 2. Criar Financial Inicial para Projeto

Quando um Estimate é aceito, criar `project_financial`:

```javascript
// Auto-criado quando acessado via API
GET /api/projects/:projectId/financial
```

### 3. Test API

```bash
# Create expense
curl -X POST http://localhost:3000/api/expenses \
  -H "Content-Type: application/json" \
  -d '{"category": "material", "amount": 1000, "expense_date": "2024-03-15", "description": "Test"}'

# Approve expense
curl -X PUT http://localhost:3000/api/expenses/1/approve

# Get dashboard
curl http://localhost:3000/api/financial/dashboard
```

---

## 🔮 Future Extensions

O sistema está preparado para:

- ✅ **QuickBooks Sync** - Estrutura pronta para integração
- ✅ **Tax Reporting** - Dados de impostos já rastreados
- ✅ **Bank Reconciliation** - Transações registradas
- ✅ **Automated Payroll Export** - Estrutura de payroll completa
- ✅ **OCR Receipt Processing** - Campos `extracted_*` prontos
- ✅ **Multi-currency** - Pode ser adicionado facilmente

---

## 📝 Best Practices

1. **Sempre aprovar antes de alocar** - Despesas/payroll precisam aprovação
2. **Bloquear quando completo** - Use `is_locked = 1` em projetos finalizados
3. **Rastrear recibos** - Upload de recibos para auditoria
4. **Monitorar variações** - `profit_variance` mostra performance
5. **Alocar corretamente** - Use `project_id` para custos diretos, NULL para overhead

---

## 🐛 Troubleshooting

### Expense não está alocando?
- Verifique se status é `approved`
- Confirme que `allocateExpense` foi chamado após aprovação
- Verifique logs do servidor

### Financial não está atualizando?
- Confirme que despesas/payroll foram aprovados
- Verifique se `recalculateProjectFinancial` está sendo chamado
- Confirme que projeto não está `is_locked`

### Dashboard não mostra dados?
- Verifique se há despesas/payroll aprovados
- Confirme período de datas
- Verifique se projetos têm `project_financials` criados

---

## 📞 Support

Para mais detalhes, consulte:
- API Documentation: `/api/financial/*` endpoints
- Frontend Code: `public/financial-engine.js`
- Calculation Logic: `services/financialCalculator.js`
