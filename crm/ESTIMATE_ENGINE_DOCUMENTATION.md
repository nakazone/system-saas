# 🏗️ Professional Flooring Estimate Engine - Documentation

## 📋 Overview

Sistema completo de estimativas profissionais para projetos de pisos, incluindo cálculo automático, regras inteligentes, visualização para cliente e analytics.

---

## 🗄️ Database Structure

### Tables Created

#### 1. **estimates**
Tabela principal de estimativas com todos os cálculos financeiros.

**Key Fields:**
- `material_cost_total` - Custo total de materiais
- `labor_cost_total` - Custo total de mão de obra
- `equipment_cost_total` - Custo total de equipamentos
- `direct_cost` - Custo direto (soma dos três acima)
- `overhead_percentage` / `overhead_amount` - Overhead
- `profit_margin_percentage` / `profit_amount` - Lucro
- `final_price` - Preço final calculado
- `status` - draft | sent | viewed | accepted | declined | expired

#### 2. **estimate_items**
Itens individuais da estimativa.

**Key Fields:**
- `category` - material | labor | equipment | overhead | profit
- `unit_type` - sqft | linear_ft | unit | stairs | fixed
- `quantity` - Quantidade
- `unit_cost` - Custo unitário
- `total_cost` - Custo total (quantity × unit_cost)
- `is_auto_added` - Se foi adicionado automaticamente por regras

#### 3. **estimate_rules**
Regras inteligentes para adicionar itens automaticamente.

#### 4. **estimate_analytics**
Tabela para analytics e relatórios.

### Schema File
Execute: `database/schema-estimates.sql`

---

## 🧮 Calculation Engine

### Core Functions (`services/estimateCalculator.js`)

#### **calculateAdjustedSqft(totalSqft, wastePercentage)**
Calcula metragem ajustada com desperdício.
```
adjusted_sqft = total_sqft × (1 + waste_percentage / 100)
```

#### **getDefaultWastePercentage(flooringType)**
Retorna percentual de desperdício padrão:
- Hardwood: 10%
- Engineered: 8%
- LVP: 5%
- Laminate: 7%
- Tile: 12%

#### **recalculateEstimate(items, overheadPercentage, profitMarginPercentage)**
Recalcula todos os valores da estimativa:
1. Soma custos por categoria (material, labor, equipment)
2. Calcula custo direto
3. Calcula overhead
4. Calcula lucro
5. Calcula preço final

#### **applySmartRules(pool, projectData, items)**
Aplica regras inteligentes e adiciona itens automaticamente:
- **Moisture Barrier**: Se hardwood + concrete subfloor
- **Leveling Compound**: Se level_condition = major
- **Stair Labor**: Se stairs_count > 0

---

## 🔌 API Routes

### Base URL: `/api/estimates`

#### **GET /api/estimates**
Lista estimativas com filtros opcionais.

**Query Parameters:**
- `page` - Número da página
- `limit` - Itens por página
- `status` - Filtrar por status
- `project_id` - Filtrar por projeto
- `lead_id` - Filtrar por lead

**Response:**
```json
{
  "success": true,
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### **GET /api/estimates/:id**
Obtém estimativa completa com itens.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "estimate_number": "EST-2024-001",
    "final_price": 15000.00,
    "items": [...]
  }
}
```

#### **POST /api/estimates**
Cria nova estimativa.

**Body:**
```json
{
  "project_id": 1,
  "lead_id": 5,
  "project_data": {
    "flooring_type": "hardwood",
    "total_sqft": 1000,
    "waste_percentage": 10,
    "subfloor_type": "concrete",
    "level_condition": "good",
    "stairs_count": 0
  },
  "items": [
    {
      "category": "material",
      "name": "Hardwood Flooring",
      "unit_type": "sqft",
      "quantity": 1100,
      "unit_cost": 8.50,
      "total_cost": 9350.00
    }
  ],
  "overhead_percentage": 15,
  "profit_margin_percentage": 25
}
```

#### **PUT /api/estimates/:id**
Atualiza estimativa.

**Body:** (campos opcionais)
```json
{
  "items": [...],
  "overhead_percentage": 18,
  "profit_margin_percentage": 30,
  "status": "sent",
  "expiration_date": "2024-12-31",
  "payment_schedule": [
    {
      "type": "Deposit",
      "percentage": 30,
      "amount": 4500.00,
      "due_date": "2024-01-15"
    }
  ]
}
```

#### **DELETE /api/estimates/:id**
Deleta estimativa.

#### **GET /api/estimates/analytics/overview**
Obtém analytics agregados.

**Response:**
```json
{
  "success": true,
  "data": {
    "margin_by_project_type": [...],
    "acceptance_rate": {
      "total": 100,
      "accepted": 65,
      "declined": 20,
      "pending": 15
    },
    "revenue_by_flooring": [...]
  }
}
```

---

## 🎨 Frontend Interfaces

### 1. **Estimate Builder** (`estimate-builder.html`)

Interface completa para construção de estimativas.

**Features:**
- ✅ Input de metragem com cálculo automático de desperdício
- ✅ Toggle para override de waste %
- ✅ Painel de breakdown de custos em tempo real
- ✅ Visualização de margem (gross profit e %)
- ✅ Scenario Simulator (ajustar overhead e profit margin)
- ✅ Aplicação automática de regras inteligentes
- ✅ Adicionar/editar/remover itens

**Usage:**
```
estimate-builder.html?project_id=1
estimate-builder.html?estimate_id=5&project_id=1
```

### 2. **Estimate View** (`estimate-view.html`)

Visualização simplificada para cliente.

**Features:**
- ✅ Scope of Work
- ✅ Total Sqft e Flooring Type
- ✅ Itens agrupados por categoria
- ✅ Payment Schedule
- ✅ Botões Accept/Decline
- ✅ Design limpo e profissional

**Usage:**
```
estimate-view.html?id=5
estimate-view.html?estimate_id=5
```

### 3. **Estimate Analytics** (`estimate-analytics.html`)

Dashboard de analytics e relatórios.

**Features:**
- ✅ Acceptance Rate
- ✅ Average Margin por Project Type
- ✅ Total Revenue
- ✅ Gráficos interativos (Chart.js)
- ✅ Revenue por Flooring Type

---

## 🧠 Smart Rules

### Regras Implementadas

1. **Waste Percentage por Flooring Type**
   - Aplicado automaticamente ao selecionar tipo de piso

2. **Moisture Barrier**
   - **Condição**: `flooring_type = hardwood` AND `subfloor_type = concrete`
   - **Ação**: Adiciona item "Moisture Barrier" @ $0.50/sqft (adjusted_sqft)

3. **Leveling Compound**
   - **Condição**: `level_condition = major`
   - **Ação**: Adiciona item "Leveling Compound" @ $1.25/sqft

4. **Stair Labor**
   - **Condição**: `stairs_count > 0`
   - **Ação**: Adiciona item "Stair Installation" @ $150.00/stair

### Adicionar Novas Regras

Edite `database/schema-estimates.sql` e adicione na tabela `estimate_rules`:

```sql
INSERT INTO estimate_rules (rule_name, rule_type, condition_json, action_json, priority) VALUES
('Your Rule Name', 'auto_item', 
 '{"condition": "value"}', 
 '{"category": "material", "name": "Item Name", "unit_type": "sqft", "unit_cost": 1.00}', 
 10);
```

---

## 📊 Calculation Flow

```
1. User inputs project data (sqft, flooring type, etc.)
   ↓
2. Apply default waste percentage
   ↓
3. Calculate adjusted_sqft = total_sqft × (1 + waste%)
   ↓
4. Apply smart rules (add auto items)
   ↓
5. User adds manual items
   ↓
6. Calculate category totals:
   - material_total = sum(material items)
   - labor_total = sum(labor items)
   - equipment_total = sum(equipment items)
   ↓
7. Calculate direct_cost = material + labor + equipment
   ↓
8. Calculate overhead = direct_cost × overhead_percentage
   ↓
9. Calculate profit = (direct_cost + overhead) × profit_margin_percentage
   ↓
10. Calculate final_price = direct_cost + overhead + profit
```

---

## 🚀 Setup Instructions

### 1. Database Setup

```bash
# Execute o schema
mysql -h [HOST] -u [USER] -p [DATABASE] < database/schema-estimates.sql
```

### 2. Verify Tables

```sql
SHOW TABLES LIKE 'estimate%';
SELECT * FROM estimate_rules;
```

### 3. Test API

```bash
# Create estimate
curl -X POST http://localhost:3000/api/estimates \
  -H "Content-Type: application/json" \
  -d '{"project_id": 1, "items": [], "overhead_percentage": 15, "profit_margin_percentage": 25}'

# Get estimate
curl http://localhost:3000/api/estimates/1

# Get analytics
curl http://localhost:3000/api/estimates/analytics/overview
```

---

## 📈 Analytics Metrics

### Tracked Metrics

1. **Average Margin per Project Type**
   - Residential vs Commercial
   - Margem média e quantidade de projetos

2. **Acceptance Rate**
   - Total estimates
   - Accepted / Declined / Pending
   - Taxa de conversão

3. **Revenue per Flooring Type**
   - Receita total por tipo de piso
   - Quantidade de projetos aceitos
   - Preço médio

---

## 🔄 Integration Points

### With Projects
- Estimates linked to `projects` table via `project_id`
- Project data used for smart rules

### With Leads
- Optional link via `lead_id`
- Can create estimate from lead

### With Users
- `created_by` tracks who created estimate
- Analytics can filter by user

---

## 🎯 Best Practices

1. **Always recalculate** after adding/removing items
2. **Use smart rules** to ensure consistency
3. **Set expiration dates** for estimates
4. **Track status changes** for analytics
5. **Use payment schedules** for better cash flow

---

## 🐛 Troubleshooting

### Estimate not calculating correctly?
- Check if items have valid `quantity` and `unit_cost`
- Verify `overhead_percentage` and `profit_margin_percentage` are set
- Check browser console for JavaScript errors

### Smart rules not applying?
- Verify project data is populated correctly
- Check `estimate_rules` table has active rules
- Ensure flooring_type matches rule conditions

### Analytics not showing?
- Verify estimates have `status = 'accepted'` for revenue
- Check database has data in `estimates` table
- Verify API endpoint is accessible

---

## 📝 Future Enhancements

- [ ] PDF generation for estimates
- [ ] Email sending to clients
- [ ] Version control (multiple versions per estimate)
- [ ] Cost variance tracking (estimated vs actual)
- [ ] Template system for common estimates
- [ ] Integration with accounting software
- [ ] Mobile app for field estimates

---

## 📞 Support

Para dúvidas ou problemas, consulte:
- API Documentation: `/api/estimates` endpoints
- Frontend Code: `public/estimate-*.html` and `*.js`
- Calculation Logic: `services/estimateCalculator.js`
