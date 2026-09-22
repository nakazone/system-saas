# Como Executar o Schema de Estimates

## Opção 1: Via Railway CLI (Recomendado)

Se você está usando Railway, execute diretamente no ambiente:

```bash
railway run node database/run-schema-estimates-simple.js
```

Isso vai usar automaticamente as variáveis de ambiente do Railway.

---

## Opção 2: Via Terminal Local (com .env)

Se você tem um arquivo `.env` configurado localmente:

1. Certifique-se de que o `.env` tem as variáveis de conexão:
   ```env
   DATABASE_PUBLIC_URL=mysql://user:password@host:port/database
   # OU
   DB_HOST=seu-host
   DB_USER=seu-usuario
   DB_PASS=sua-senha
   DB_NAME=seu-banco
   ```

2. Execute:
   ```bash
   cd senior-floors-system
   node database/run-schema-estimates-simple.js
   ```

---

## Opção 3: Via MySQL Diretamente

Se preferir executar o SQL diretamente:

1. Conecte ao MySQL:
   ```bash
   mysql -h [HOST] -u [USER] -p [DATABASE]
   ```

2. Execute o arquivo:
   ```bash
   mysql -h [HOST] -u [USER] -p [DATABASE] < database/schema-estimates.sql
   ```

**Nota:** O arquivo SQL usa `IF NOT EXISTS` em alguns lugares, mas MySQL não suporta isso em `ALTER TABLE`. O script Node.js trata isso automaticamente.

---

## Verificar se Funcionou

Após executar, verifique se as tabelas foram criadas:

```sql
SHOW TABLES LIKE 'estimate%';
```

Você deve ver:
- `estimates`
- `estimate_items`
- `estimate_rules`
- `estimate_analytics`

E verificar se as colunas foram adicionadas em `projects`:

```sql
DESCRIBE projects;
```

Você deve ver as novas colunas:
- `client_id`
- `project_type`
- `service_type`
- `flooring_type`
- `total_sqft`
- `waste_percentage`
- `adjusted_sqft`
- `subfloor_type`
- `level_condition`
- `stairs_count`
- `rooms_count`

---

## Troubleshooting

### Erro: "MySQL connection variables not found"

**Solução:** Configure as variáveis de ambiente:
- No Railway: As variáveis já devem estar configuradas automaticamente
- Localmente: Crie um arquivo `.env` com as credenciais

### Erro: "Duplicate column name"

**Solução:** Isso é normal! O script ignora esses erros. As colunas já existem.

### Erro: "Table already exists"

**Solução:** Normal também! As tabelas já foram criadas anteriormente.

---

## Scripts Disponíveis

1. **`run-schema-estimates-simple.js`** - Versão simplificada (recomendada)
   - Trata erros automaticamente
   - Executa statement por statement se necessário
   - Mostra progresso detalhado

2. **`run-schema-estimates.js`** - Versão completa
   - Mais detalhada
   - Melhor para debug

---

## Próximos Passos

Após executar o schema com sucesso:

1. ✅ Verifique as tabelas criadas
2. ✅ Teste criar uma estimativa via API
3. ✅ Acesse o Estimate Builder no frontend

---

## Suporte

Se ainda tiver problemas, verifique:
- Variáveis de ambiente estão configuradas?
- Conexão com o banco está funcionando?
- O arquivo `schema-estimates.sql` existe?

Para mais detalhes, veja: `ESTIMATE_ENGINE_DOCUMENTATION.md`
