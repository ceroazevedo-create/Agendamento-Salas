# MANIFESTO DE INTEGRAÇÃO SUPABASE — LOCAPSICO

Este documento estabelece a auditoria completa, rigorosa e exaustiva da arquitetura do aplicativo **LocaPsico (Gestão & Locação de Salas Clínicas)**, mapeando minuciosamente cada dependência, modelo de dados, regra de negócio e especificação técnica para uma integração real e em produção com o **Supabase** (PostgreSQL + Supabase Auth).

---

## 1. RESUMO DA ARQUITETURA ATUAL

- **Framework Utilizado:** React 19 (`react` v19.2.1, `react-dom` v19.2.1) integrado via Vite 6 (`vite` v6.2.0) operando como Single Page Application (SPA).
- **Linguagem:** TypeScript 5.8 (`typescript` ~5.8.2) em modo estrito (`strict: true`), com tipagem centralizada.
- **Estrutura Principal do Projeto:**
  - `/` (Raiz): Arquivos de entrada e configuração do projeto (`index.html`, `index.tsx`, `App.tsx`, `constants.ts`, `types.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `metadata.json`).
  - `/components/`: Componentes visuais da interface, formulários, modais e visualizações de tela (`Calendar.tsx`, `UserDashboard.tsx`, `AdminPanel.tsx`, `ClientsManager.tsx`, `AuthForms.tsx`, `Modal.tsx`, `Button.tsx`, `Input.tsx`, `PasswordInput.tsx`, `Toast.tsx`).
  - `/services/`: Camada de serviços assíncronos que conectam o app ao Supabase com camada de fallback/cache local (`authService.ts`, `bookingService.ts`, `clientService.ts`, `storageService.ts`, `seedData.ts`, `supabase.ts`).
  - `/utils/`: Utilitários auxiliares de validação e segurança (`passwordSecurity.ts`).
  - `/supabase/`: Scripts e migrations SQL existentes para referência (`supabase/migrations/20260910000000_create_locapsico_schema.sql`, `supabase/seed.sql`).
- **Onde ficam os Componentes:** Diretório `/components`.
- **Onde ficam os Serviços de Dados:** Diretório `/services`.
- **Onde ficam os Tipos e Interfaces:** Arquivo raiz `/types.ts`.
- **Onde atualmente estão os Mocks / Dados Demonstrativos:**
  - Arquivo `/services/seedData.ts` (contém `INITIAL_USERS`, `INITIAL_CLIENTS`, `INITIAL_BOOKINGS`, `INITIAL_BLOCKED_SLOTS`, `INITIAL_AUDIT_LOGS`, `INITIAL_ROOMS`, `INITIAL_CONFIG`).
  - Constantes auxiliares em `/constants.ts` (`DEMO_USERS`, `DEMO_ACCOUNTS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `INITIAL_HOURLY_RATE`, `INITIAL_DAILY_RATE`).
- **Uso de LocalStorage / SessionStorage:**
  - O aplicativo utiliza `localStorage` gerenciado pelo arquivo `/services/storageService.ts` sob as chaves:
    - `locapsico_users_v2`: Usuários cadastrados no modo offline/fallback.
    - `locapsico_clients_v2`: Clientes/pacientes cadastrados localmente.
    - `locapsico_bookings_v2`: Locações e agendamentos locais.
    - `locapsico_blocked_v2`: Bloqueios administrativos de salas.
    - `locapsico_audit_v2`: Registros de auditoria de operações.
    - `locapsico_config_v2`: Configurações globais do espaço e salas.
    - `locapsico_session_v2`: Cache da sessão do usuário ativo.
    - `locapsico_seeded_v2`: Flag booleana de inicialização de seed local.
- **Se existe algum Banco Atualmente:**
  - Há integração iniciada com o Supabase via biblioteca `@supabase/supabase-js` (v2.48.1) configurada em `/services/supabase.ts`. Os serviços contêm chamadas para `auth.signUp`, `auth.signInWithPassword`, e tabelas `profiles`, `professionals`, `clients`, `rooms`, `bookings`, `blocked_slots`, `settings`, `audit_logs` e `payments`.
  - Quando a conexão com o Supabase está ausente ou ocorrem falhas de rede, o código ativa automaticamente mecanismos de contingência baseados em `localStorage`.
- **Como a Autenticação Funciona Atualmente:**
  - O arquivo `/services/authService.ts` implementa autenticação via Supabase Auth (`supabase.auth.signInWithPassword`, `signUp`, `signOut`, `getSession`, `updateUser`).
  - No fluxo de cadastro (`register`), o e-mail `admin@admin.com.br` recebe a role `ADMIN`. Todos os outros usuários recebem obrigatoriamente a role `USER` (`professional` no banco).
  - Em modo demo/fallback local, valida as credenciais contra a lista de demonstração armazenada em `localStorage`.
- **Como o Calendário Funciona Atualmente:**
  - Implementado em `/components/Calendar.tsx` utilizando `date-fns` v4.1 com suporte a visualizações: Diária (`day`), Semanal (`week`) e Mensal (`month`).
  - O horário operacional padrão compreende das **07:00 às 22:00** (faixas horárias de 1 em 1 hora, totalizando 15 faixas por dia).
  - Domingos são bloqueados institucionalmente (`EXTRACT(DOW) = 0`).
  - O componente exibe status de ocupação para **Sala 1** e **Sala 2**, exibe bloqueios administrativos, feriados (com controle de liberação global ou individual) e abre o modal de reserva rápida.
- **Como as Reservas Funcionam Atualmente:**
  - Implementadas em `/services/bookingService.ts`. Suportam locação avulsa por hora (`HOURLY`) e locação de período integral (`PERIOD`).
  - O preço unitário por hora e o valor total são **congelados no momento da criação da reserva**, salvando os campos `priceAtBooking` (ou `hourly_rate`) e `totalAmount` (ou `total_amount`).
  - Regra de cancelamento: Profissionais comuns só podem cancelar com no mínimo **24 horas de antecedência** da data/hora de início da reserva. Administradores podem cancelar a qualquer momento.
- **Como o Financeiro Funciona Atualmente:**
  - O financeiro calcula a receita total, valores pagos e valores pendentes agrupados por mês (`YYYY-MM`), por profissional e por sala.
  - O status de pagamento pode ser: `PENDING` (Pendente), `PAID` (Pago) ou `CANCELLED` (Cancelado).
  - A confirmação de pagamento é realizada pelo Administrador através do `AdminPanel.tsx` ou via `bookingService.updatePaymentStatus`, registrando data de pagamento (`paid_at`), notas fiscais/comprovante (`paid_notes`), identificação do administrador responsável (`paid_by_admin`) e gerando um registro na tabela `payments`.
  - Exportação de relatórios financeiros e de consumo em PDF via `jspdf` e `jspdf-autotable`.

---

## 2. VARIÁVEIS DE AMBIENTE

O aplicativo requer exclusivamente as variáveis públicas padrão do cliente Supabase para Vite.

### Variáveis Identificadas:

1. **`VITE_SUPABASE_URL`**
   - **Finalidade:** Endereço HTTPS do projeto Supabase (REST API e Auth Gateway). Exemplo de formato: `https://[project-ref].supabase.co`.
   - **Obrigatória ou Opcional:** Obrigatória para a comunicação com a API real do Supabase.
   - **Onde é utilizada no código:** Utilizada em `/services/supabase.ts` (linha 9) na função `createClient(supabaseUrl, supabaseAnonKey)`.
   - **Pública ou Secreta:** Pública (embutida no bundle cliente do Vite via `import.meta.env`).

2. **`VITE_SUPABASE_ANON_KEY`**
   - **Finalidade:** Chave pública anônima (JWT) do Supabase que concede acesso ao client SDK respeitando rigorosamente as políticas de Row Level Security (RLS).
   - **Obrigatória ou Opcional:** Obrigatória para comunicação autenticada e anônima.
   - **Onde é utilizada no código:** Utilizada em `/services/supabase.ts` (linha 10) na função `createClient(supabaseUrl, supabaseAnonKey)`.
   - **Pública ou Secreta:** Pública (Token JWT anon exposto no navegador do cliente).

*Nota de Segurança:* Nenhuma chave de serviço (`service_role_key`) ou credencial de banco (`DATABASE_URL`, `POSTGRES_PASSWORD`) deve ser incluída no frontend do aplicativo.

---

## 3. AUTENTICAÇÃO

O fluxo de autenticação deve ser ancorado inteiramente no **Supabase Auth (`auth.users`)** em consonância com a tabela pública de perfis (`public.profiles`).

### Fluxos Detalhados:

- **Cadastro (`signUp`):**
  - O usuário informa: Nome Completo, E-mail, Senha, Confirmação de Senha, CPF, Telefone, WhatsApp, Profissão e Registro Profissional (CRP, CRM, CRN, etc.).
  - A senha deve cumprir os requisitos de segurança definidos em `passwordSecurity.ts` (mínimo 6 caracteres).
  - **Diferenciação Estrita de Permissões:** O usuário comum **NÃO** tem a opção de escolher ser administrador.
  - A role é estritamente fixada:
    - Se `cleanEmail === 'admin@admin.com.br'` $\rightarrow$ `role = 'admin'`.
    - Para qualquer outro e-mail $\rightarrow$ `role = 'professional'` (mapeado como `USER` no frontend).
  - O Supabase cria o registro em `auth.users`. Uma trigger `on_auth_user_created` gera automaticamente os registros correspondentes em `public.profiles` e `public.professionals`.
- **Login (`signInWithPassword`):**
  - Realizado com `email` e `password`.
  - Ao autenticar, o sistema consulta `public.profiles` para carregar `full_name`, `role` e `status`.
  - Se o `status` for `'INACTIVE'`, o sistema invoca imediatamente `supabase.auth.signOut()` e bloqueia o acesso com a mensagem: *"Esta conta está inativa. Entre em contato com a administração."*
- **Logout (`signOut`):**
  - Executa `supabase.auth.signOut()`, limpa a sessão em cache e redireciona para a tela inicial de autenticação.
- **Recuperação de Senha (`resetPasswordForEmail`):**
  - Envia e-mail de recuperação padrão do Supabase redirecionando para a URL de origem da aplicação.
- **Redefinição de Senha Administrativa:**
  - O Administrador no painel geral pode gerar uma nova senha provisória para um profissional, utilizando a RPC administrativa ou atualização de senha.
- **Sessão & Persistência:**
  - Gerenciada pelo cliente Supabase com `persistSession: true` e `autoRefreshToken: true`. A aplicação revalida o token e perfil a cada inicialização em `App.tsx` via `authService.getCurrentUser()`.

### Separação de Dados:

- **Dados em `auth.users`:**
  - `id` (UUID gerado pelo Auth), `email`, `encrypted_password`, `email_confirmed_at`, `created_at`, `raw_user_meta_data`.
- **Dados em `public.profiles` e `public.professionals`:**
  - `full_name`, `cpf`, `phone`, `whatsapp`, `professional_type`, `registration_number`, `role`, `status`, `created_at`, `updated_at`.

---

## 4. TABELAS NECESSÁRIAS

Abaixo está a especificação técnica exata das 9 tabelas requeridas pelo aplicativo.

### 4.1. Tabela: `profiles`
**Finalidade:** Armazena o perfil base de cada usuário autenticado no sistema, vinculado diretamente ao `auth.users`.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | N/A | Não | **Sim** | Sim | `auth.users(id) ON DELETE CASCADE` |
| `full_name` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `email` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `phone` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `cpf` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `role` | `TEXT` | Sim | `'professional'` | Não | Não | Não | N/A (CHECK: `'admin'`, `'professional'`) |
| `status` | `TEXT` | Sim | `'ACTIVE'` | Não | Não | Não | N/A (CHECK: `'ACTIVE'`, `'INACTIVE'`) |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.2. Tabela: `professionals`
**Finalidade:** Cadastro complementar dos profissionais de saúde clínica (número de conselho, profissão, dados de contato).

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `user_id` | `UUID` | Sim | N/A | Não | Não | Sim | `public.profiles(id) ON DELETE CASCADE` (UNIQUE) |
| `full_name` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `email` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `phone` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `cpf` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `professional_type` | `TEXT` | Sim | `'Psicólogo(a)'` | Não | Não | Não | N/A |
| `registration_number`| `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `status` | `TEXT` | Sim | `'ACTIVE'` | Não | Não | Não | N/A (CHECK: `'ACTIVE'`, `'INACTIVE'`) |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.3. Tabela: `clients`
**Finalidade:** Armazena os pacientes/clientes de cada profissional clínico. Rigorosamente privada.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `professional_id` | `UUID` | Sim | N/A | Não | Não | Sim | `public.profiles(id) ON DELETE CASCADE` |
| `full_name` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `cpf` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `birth_date` | `DATE` | Não | NULL | Sim | Não | Não | N/A |
| `phone` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `whatsapp` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `email` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `address` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `notes` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `status` | `TEXT` | Sim | `'ACTIVE'` | Não | Não | Não | N/A (CHECK: `'ACTIVE'`, `'INACTIVE'`) |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.4. Tabela: `rooms`
**Finalidade:** Cadastro das salas clínicas e seus valores de locação por hora e período.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `TEXT` | Sim | N/A | Não | **Sim** | Não | N/A (Valores: `'Sala 1'`, `'Sala 2'`) |
| `name` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `description` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `hourly_rate` | `NUMERIC(10,2)`| Sim | `40.00` | Não | Não | Não | N/A |
| `period_rate` | `NUMERIC(10,2)`| Sim | `350.00` | Não | Não | Não | N/A |
| `opening_time` | `INTEGER` | Sim | `7` | Não | Não | Não | N/A |
| `closing_time` | `INTEGER` | Sim | `22` | Não | Não | Não | N/A |
| `status` | `TEXT` | Sim | `'ACTIVE'` | Não | Não | Não | N/A (CHECK: `'ACTIVE'`, `'MAINTENANCE'`) |
| `notes` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.5. Tabela: `bookings`
**Finalidade:** Registro de todas as locações e agendamentos com congelamento de valores.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `professional_id` | `UUID` | Sim | N/A | Não | Não | Sim | `public.profiles(id) ON DELETE CASCADE` |
| `client_id` | `UUID` | Não | NULL | Sim | Não | Sim | `public.clients(id) ON DELETE SET NULL` |
| `room_id` | `TEXT` | Sim | N/A | Não | Não | Sim | `public.rooms(id) ON DELETE RESTRICT` |
| `booking_date` | `DATE` | Sim | N/A | Não | Não | Não | N/A |
| `start_time` | `INTEGER` | Sim | N/A | Não | Não | Não | N/A (CHECK: `>= 7 AND < 22`) |
| `end_time` | `INTEGER` | Sim | N/A | Não | Não | Não | N/A (CHECK: `> 7 AND <= 22`) |
| `booking_type` | `TEXT` | Sim | `'HOURLY'` | Não | Não | Não | N/A (CHECK: `'HOURLY'`, `'PERIOD'`) |
| `total_hours` | `INTEGER` | Sim | `1` | Não | Não | Não | N/A |
| `hourly_rate` | `NUMERIC(10,2)`| Sim | `40.00` | Não | Não | Não | N/A (Congelado no agendamento) |
| `period_rate` | `NUMERIC(10,2)`| Sim | `350.00` | Não | Não | Não | N/A (Congelado no agendamento) |
| `total_amount` | `NUMERIC(10,2)`| Sim | N/A | Não | Não | Não | N/A (Congelado no agendamento) |
| `payment_status` | `TEXT` | Sim | `'PENDING'` | Não | Não | Não | N/A (CHECK: `'PENDING'`, `'PAID'`, `'CANCELLED'`) |
| `status` | `TEXT` | Sim | `'confirmed'` | Não | Não | Não | N/A (CHECK: `'confirmed'`, `'cancelled'`, `'completed'`) |
| `notes` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `paid_at` | `TIMESTAMPTZ`| Não | NULL | Sim | Não | Não | N/A |
| `paid_notes` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `paid_by_admin` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.6. Tabela: `payments`
**Finalidade:** Histórico e auditoria financeira das liquidações de reservas realizadas pelos profissionais.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `booking_id` | `UUID` | Não | NULL | Sim | Não | Sim | `public.bookings(id) ON DELETE SET NULL` |
| `professional_id` | `UUID` | Sim | N/A | Não | Não | Sim | `public.profiles(id) ON DELETE CASCADE` |
| `amount` | `NUMERIC(10,2)`| Sim | N/A | Não | Não | Não | N/A |
| `payment_date` | `DATE` | Sim | `CURRENT_DATE` | Não | Não | Não | N/A |
| `status` | `TEXT` | Sim | `'PAID'` | Não | Não | Não | N/A (CHECK: `'PAID'`, `'PENDING'`, `'CANCELLED'`) |
| `notes` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `created_by` | `TEXT` | Não | NULL | Sim | Não | Não | N/A |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.7. Tabela: `blocked_slots`
**Finalidade:** Bloqueios operacionais da agenda (manutenção, reuniões clínicas, feriados e interdições).

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `room_id` | `TEXT` | Sim | N/A | Não | Não | Não | N/A (Valores: `'Sala 1'`, `'Sala 2'`, `'ALL'`) |
| `blocked_date` | `DATE` | Sim | N/A | Não | Não | Não | N/A |
| `start_time` | `INTEGER` | Sim | N/A | Não | Não | Não | N/A |
| `end_time` | `INTEGER` | Sim | N/A | Não | Não | Não | N/A |
| `reason` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `created_by` | `TEXT` | Sim | `'Administração'`| Não | Não | Não | N/A |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.8. Tabela: `settings`
**Finalidade:** Configurações globais do estabelecimento (horários, limites de cancelamento, feriados).

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `TEXT` | Sim | `'global'` | Não | **Sim** | Não | N/A (Registro único) |
| `establishment_name` | `TEXT` | Sim | `'Espaço Terapêutico & Clínico LocaPsico'` | Não | Não | Não | N/A |
| `contact_email` | `TEXT` | Sim | `'contato@locapsico.com.br'` | Não | Não | Não | N/A |
| `contact_phone` | `TEXT` | Sim | `'(11) 98765-4321'` | Não | Não | Não | N/A |
| `open_hour` | `INTEGER` | Sim | `7` | Não | Não | Não | N/A |
| `close_hour` | `INTEGER` | Sim | `22` | Não | Não | Não | N/A |
| `cancellation_limit_hours` | `INTEGER` | Sim | `24` | Não | Não | Não | N/A |
| `allow_holidays_global` | `BOOLEAN` | Sim | `false` | Não | Não | Não | N/A |
| `unblocked_holidays` | `TEXT[]` | Sim | `'{}'` | Não | Não | Não | N/A |
| `created_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |
| `updated_at` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

### 4.9. Tabela: `audit_logs`
**Finalidade:** Registro e rastreabilidade de todas as ações sensíveis realizadas no sistema.

| Coluna | Tipo | Obrigatória? | Default | Null? | Primary Key? | Foreign Key? | Referência |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | Sim | `gen_random_uuid()` | Não | **Sim** | Não | N/A |
| `user_id` | `UUID` | Não | NULL | Sim | Não | Sim | `public.profiles(id) ON DELETE SET NULL` |
| `user_name` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `action` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `details` | `TEXT` | Sim | N/A | Não | Não | Não | N/A |
| `timestamp` | `TIMESTAMPTZ`| Sim | `now()` | Não | Não | Não | N/A |

---

## 5. RELACIONAMENTOS

```text
auth.users (id)
    │
    ▼ 1:1
public.profiles (id)
    │
    ├───► 1:1  public.professionals (user_id)
    │
    ├───► 1:N  public.clients (professional_id)
    │             │
    │             └───► 0..1:N  public.bookings (client_id)
    │
    ├───► 1:N  public.bookings (professional_id)
    │             │
    │             └───► 0..1:N  public.payments (booking_id)
    │
    ├───► 1:N  public.payments (professional_id)
    │
    └───► 0..1:N  public.audit_logs (user_id)

public.rooms (id)
    │
    └───► 1:N  public.bookings (room_id)
```

### Detalhamento das Relações Estruturais:
1. `auth.users.id` $\leftrightarrow$ `profiles.id` (1:1 — chave primária compartilhada).
2. `profiles.id` $\leftrightarrow$ `professionals.user_id` (1:1 — exclusão em cascata).
3. `profiles.id` $\rightarrow$ `clients.professional_id` (1:N — cada paciente pertence exclusivamente a um profissional).
4. `profiles.id` $\rightarrow$ `bookings.professional_id` (1:N — locações contratadas pelo profissional).
5. `clients.id` $\rightarrow$ `bookings.client_id` (0..1:N — vínculo opcional da reserva com o paciente, `ON DELETE SET NULL`).
6. `rooms.id` $\rightarrow$ `bookings.room_id` (1:N — vínculo com a sala, `ON DELETE RESTRICT` para preservar o histórico).
7. `bookings.id` $\rightarrow$ `payments.booking_id` (0..1:1 — vínculo do comprovante de pagamento à reserva, `ON DELETE SET NULL`).
8. `profiles.id` $\rightarrow$ `payments.professional_id` (1:N — pagamentos efetuados pelo profissional).
9. `profiles.id` $\rightarrow$ `audit_logs.user_id` (0..1:N — usuário autor da ação de auditoria).

---

## 6. RESERVAS / AGENDAMENTOS

### Dados Necessários por Reserva:
- `id`: Identificador único (`UUID`).
- `professional_id`: UUID do profissional que reservou.
- `client_id`: UUID do paciente atendido (opcional).
- `room_id`: Identificação da sala (`'Sala 1'` ou `'Sala 2'`).
- `booking_date`: Data da locação no formato `YYYY-MM-DD`.
- `start_time`: Horário de início inteiro (`7` até `21`).
- `end_time`: Horário de término inteiro (`8` até `22`).
- `total_hours`: Quantidade de horas da reserva (`end_time - start_time`).
- `booking_type`: `'HOURLY'` (Horista) ou `'PERIOD'` (Período integral).
- `hourly_rate`: Tarifa por hora aplicada no ato da reserva (ex: `40.00`).
- `period_rate`: Tarifa do período integral aplicada no ato (ex: `350.00`).
- `total_amount`: Valor total devido, congelado (ex: `40.00` para 1h, `80.00` para 2h, `350.00` para período integral).
- `payment_status`: Status financeiro (`'PENDING'`, `'PAID'`, `'CANCELLED'`).
- `status`: Status da locação (`'confirmed'`, `'cancelled'`, `'completed'`).
- `notes`: Observações clínicas ou operacionais.
- `paid_at`: Data e hora da quitação do pagamento.
- `paid_notes`: Observação do pagamento/comprovante.
- `paid_by_admin`: Nome do administrador que deu a baixa financeira.
- `created_at` / `updated_at`: Timestamps de auditoria.

### Diferenciação entre os Tipos de Reserva no Código:
1. **Reserva por Hora (`HOURLY`):**
   - O profissional seleciona um horário de início (`start_time`) e uma duração (`durationHours`, tipicamente 1h a 4h).
   - O `end_time` é calculado como `start_time + durationHours`.
   - O valor total é calculado por: `totalAmount = durationHours * hourlyRate`.
2. **Reserva do Período Integral (`PERIOD`):**
   - O profissional contrata o dia inteiro na sala (atendimentos contínuos).
   - No código do formulário de agendamento (`Calendar.tsx`), ao selecionar `PERIOD`, o sistema fixa o horário das **07:00 às 22:00** (ou das **08:00 às 21:00** conforme configuração do seed), preenchendo as 15 horas do dia.
   - O valor total **NÃO** multiplica por hora; aplica a tarifa fixa integral: `totalAmount = periodRate` (R$ 350,00).
   - Nenhuma outra reserva avulsa pode ser inserida em qualquer horário daquele dia para aquela sala.

---

## 7. CONFLITOS DE HORÁRIO

### Regras de Proteção de Integridade:
Uma reserva é considerada conflitante e **inválida** se tentar ocupar:
1. A **mesma sala** (`room_id`).
2. A **mesma data** (`booking_date`).
3. Com **sobreposição temporal**:
   - Intervalo `[start_time, end_time)` se interceptando com outro agendamento ativo:
     $$\max(\text{start\_time}_1, \text{start\_time}_2) < \min(\text{end\_time}_1, \text{end\_time}_2)$$
4. Se já existir uma reserva `PERIOD` na mesma data e sala, ou se a nova for `PERIOD` e houver qualquer reserva ativa naquele dia.
5. Se o intervalo coincidir com um bloqueio administrativo da sala (`blocked_slots`) ou com um bloqueio global (`room_id = 'ALL'`).
6. Reservas aos **domingos** (`DOW = 0`) são sumariamente rejeitadas.
7. Reservas canceladas (`payment_status = 'CANCELLED'` ou `status = 'cancelled'`) são **desconsideradas** no cálculo de conflito, liberando o horário para outros profissionais.

### Status Atual da Proteção:
- Atualmente, a validação de conflito roda no **Frontend** (`bookingService.checkConflict` e `Calendar.tsx`), e há também uma função trigger descrita na migration SQL.
- **Risco:** Sem uma trigger ativa e enforced no banco de dados, duas requisições simultâneas (race condition) poderiam criar duas reservas no mesmo horário.

### Solução PostgreSQL / Supabase Necessária:
Implementação de uma **Trigger `BEFORE INSERT OR UPDATE`** na tabela `public.bookings`:
- Função: `public.check_booking_conflict()`
- Bloqueia a inserção via `RAISE EXCEPTION` caso ocorra qualquer sobreposição com reserva ativa ou bloqueio de sala.
- Garante atomicidade e integridade no nível do banco de dados (ACID).

---

## 8. CLIENTES / PACIENTES

### Campos do Cadastro de Clientes:

| Campo | Tipo | Classificação | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | Obrigatório | Chave primária |
| `professional_id` | `UUID` | Obrigatório | ID do profissional titular |
| `full_name` | `TEXT` | Obrigatório | Nome completo do paciente |
| `cpf` | `TEXT` | Opcional | CPF formatado |
| `birth_date` | `DATE` | Opcional | Data de nascimento |
| `phone` | `TEXT` | Obrigatório | Telefone principal |
| `whatsapp` | `TEXT` | Opcional | WhatsApp para lembretes |
| `email` | `TEXT` | Opcional | E-mail de contato |
| `address` | `TEXT` | Opcional | Endereço residencial |
| `notes` | `TEXT` | Opcional / Privado | Anotações clínicas confidenciais |
| `status` | `TEXT` | Obrigatório | `'ACTIVE'` ou `'INACTIVE'` |
| `created_at` | `TIMESTAMPTZ`| Obrigatório | Data do cadastro |

### Regra de Privacidade Estrita (Sigilo Profissional e LGPD):
- **O profissional DEVE enxergar EXCLUSIVAMENTE os seus próprios pacientes.**
- Sob nenhuma hipótese um profissional pode listar, visualizar, buscar ou associar pacientes de outro profissional.
- O Administrador possui permissão de auditoria para supervisão de prontuários em caso de necessidade regulatória.
- **Aplicação no Supabase:** Política de Row Level Security (RLS) baseada em:
  ```sql
  auth.uid() = professional_id OR public.is_admin()
  ```

---

## 9. PROFISSIONAIS

### Dados Armazenados:
- `id`: UUID do registro profissional.
- `user_id`: UUID vinculado à chave primária de `public.profiles(id)`.
- `full_name`: Nome completo com titulação (ex: *Dra. Helena Castro*).
- `email`: E-mail corporativo/profissional único.
- `phone`: Telefone de contato institucional.
- `cpf`: Cadastro de Pessoa Física.
- `professional_type`: Categoria profissional (`'Psicólogo(a)'`, `'Psicoterapeuta'`, `'Nutricionista'`, etc.).
- `registration_number`: Número de inscrição no conselho de classe (`CRP 06/123456`, `CRN 3-45678`, etc.).
- `status`: Situação do credenciamento (`'ACTIVE'` ou `'INACTIVE'`).
- `created_at` / `updated_at`: Timestamps.

---

## 10. SALAS

### Dados e Estrutura das Salas:
O sistema trabalha com **2 salas clínicas físicas**:

1. **`Sala 1`**
   - Nome exibido: *Sala 1 — Psicoterapia & Acolhimento* (ou *Atendimento Adulto & Casal*).
   - Descrição: Poltronas ergonômicas reclináveis, isolamento acústico duplo, iluminação dimerizável e climatização individual.
   - Capacidade: Atendimento individual e de casal.
   - Tarifa Horária Padrão: **R$ 40,00**.
   - Tarifa Período Integral Padrão: **R$ 350,00**.
   - Horário de Funcionamento: 07:00 às 22:00.

2. **`Sala 2`**
   - Nome exibido: *Sala 2 — Multidisciplinar & Infantil*.
   - Descrição: Espaço com mesa de atendimento lúdica, divã, tatame higienizável e armário com materiais terapêuticos.
   - Capacidade: Psicologia infantil, fonoaudiologia, nutrição e terapias integrativas.
   - Tarifa Horária Padrão: **R$ 40,00**.
   - Tarifa Período Integral Padrão: **R$ 350,00**.
   - Horário de Funcionamento: 07:00 às 22:00.

### Identificadores:
O código utiliza os identificadores literais `'Sala 1'` e `'Sala 2'` como chave primária (`RoomId = 'Sala 1' | 'Sala 2'`).

---

## 11. PREÇOS E FINANCEIRO

### Lógica Financeira do Sistema:
- **Onde o preço é definido:**
  - Cadastrado por sala na tabela `rooms` (`hourly_rate` e `period_rate`).
  - Editável pelo Administrador na aba *Salas* do `AdminPanel.tsx` via `bookingService.updateRoomRates`.
- **Onde o preço é calculado:**
  - No frontend (`Calendar.tsx` e `bookingService.createBooking`):
    - Se `booking_type === 'HOURLY'` $\rightarrow$ `totalAmount = durationHours * hourlyRate`.
    - Se `booking_type === 'PERIOD'` $\rightarrow$ `totalAmount = periodRate`.
- **Congelamento Histórico do Valor:**
  - O valor da reserva é **imutavelmente persistido** nos campos `hourly_rate`, `period_rate` e `total_amount` da tabela `bookings`.
  - Uma alteração posterior na tarifa da sala em `rooms` **NÃO** altera o valor de locações já criadas. O código atual **já suporta e exige essa preservação**.
- **Pagamentos e Liquidação:**
  - Status inicial: `'PENDING'`.
  - Ao ser marcado como `'PAID'` pelo Administrador, o sistema registra `paid_at`, `paid_notes`, `paid_by_admin` e insere um registro formal na tabela `payments`.
- **Cancelamentos:**
  - Ao ser cancelada, a reserva muda para `payment_status = 'CANCELLED'`.
  - O valor da reserva cancelada é desconsiderado dos totais de receita e de consumo a pagar.
- **Relatórios & Consumo Mensal:**
  - O profissional acompanha seu extrato em *Meus Consumos* (`UserDashboard.tsx`): Total de horas utilizadas no mês, Total Gasto (R$), Total Pago (R$) e Total Pendente (R$).
  - O administrador acompanha o faturamento geral, taxa de inadimplência e emite relatórios analíticos em PDF.

---

## 12. BLOQUEIOS DE AGENDA

### Bloqueio de Horários e Salas (`blocked_slots`):
O sistema possui funcionalidade completa de interdição de horários gerenciada pelo Administrador:
- `id`: UUID.
- `room_id`: Identificador da sala (`'Sala 1'`, `'Sala 2'`) ou `'ALL'` (para fechar todas as salas simultaneamente).
- `blocked_date`: Data do bloqueio (`YYYY-MM-DD`).
- `start_time`: Horário de início inteiro (`7` a `21`).
- `end_time`: Horário de término inteiro (`8` a `22`).
- `reason`: Motivo institucional (ex: *"Higienização e Manutenção do Ar Condicionado"*, *"Reunião Geral da Equipe Clínica"*).
- `created_by`: Nome do administrador autor.
- `created_at`: Data de criação.

---

## 13. ROW LEVEL SECURITY — RLS

Todas as tabelas devem possuir **Row Level Security Habilitado (`ENABLE ROW LEVEL SECURITY`)**.

### Políticas de Acesso Detalhadas:

#### 1. `profiles`
- **SELECT:** `auth.uid() = id OR public.is_admin()`
- **UPDATE:** `auth.uid() = id OR public.is_admin()`
- **INSERT:** Trigger automática (`handle_new_user`) ou `auth.uid() = id`.

#### 2. `professionals`
- **SELECT:** `auth.uid() = user_id OR public.is_admin()`
- **UPDATE:** `auth.uid() = user_id OR public.is_admin()`
- **INSERT:** Trigger automática ou `auth.uid() = user_id`.

#### 3. `clients`
- **SELECT:** `auth.uid() = professional_id OR public.is_admin()`
- **INSERT:** `auth.uid() = professional_id OR public.is_admin()`
- **UPDATE:** `auth.uid() = professional_id OR public.is_admin()`
- **DELETE:** `auth.uid() = professional_id OR public.is_admin()`

#### 4. `rooms`
- **SELECT:** `true` (qualquer usuário autenticado pode visualizar as salas).
- **ALL (INSERT/UPDATE/DELETE):** `public.is_admin()` (apenas admin altera dados e tarifas).

#### 5. `bookings`
- **SELECT:**
  - `auth.uid() = professional_id OR public.is_admin()` (dados completos).
  - `true` para colunas de ocupação da grade pública (`room_id`, `booking_date`, `start_time`, `end_time`, `booking_type`, `payment_status`), ocultando dados do paciente e notas para outros profissionais.
- **INSERT:** `auth.uid() = professional_id OR public.is_admin()`
- **UPDATE:** `auth.uid() = professional_id OR public.is_admin()`
- **DELETE:** `public.is_admin()` (cancelamentos são updates de status).

#### 6. `payments`
- **SELECT:** `auth.uid() = professional_id OR public.is_admin()`
- **ALL:** `public.is_admin()`

#### 7. `blocked_slots`
- **SELECT:** `true` (todos os usuários autenticados visualizam bloqueios na agenda).
- **ALL:** `public.is_admin()`

#### 8. `settings`
- **SELECT:** `true` (todos os usuários autenticados visualizam as configurações).
- **ALL:** `public.is_admin()`

#### 9. `audit_logs`
- **INSERT:** `true` (qualquer usuário autenticado gera log de suas ações).
- **SELECT:** `public.is_admin()` (somente administradores auditam).

---

## 14. FUNÇÕES / RPC / TRIGGERS

1. **`public.is_admin()` (Função Auxiliar)**
   - **Finalidade:** Retorna booleano indicando se o `auth.uid()` solicitante possui `role = 'admin'` na tabela `profiles`. `SECURITY DEFINER` para evitar recursão de RLS.
2. **`public.handle_new_user()` (Trigger Function)**
   - **Finalidade:** Disparada após `INSERT ON auth.users`. Cria automaticamente o registro em `profiles` e `professionals` a partir dos metadados informados no cadastro. Garante que ninguém além de `admin@admin.com.br` receba a role `'admin'`.
3. **`public.check_booking_conflict()` (Trigger Function)**
   - **Finalidade:** Disparada `BEFORE INSERT OR UPDATE` em `bookings`. Valida se há conflito de horário com reservas ativas ou bloqueios na mesma data e sala, e impede reservas aos domingos.
4. **`public.handle_updated_at()` (Trigger Function)**
   - **Finalidade:** Atualiza automaticamente o campo `updated_at = now()` em todas as tabelas com modificações.

---

## 15. ÍNDICES DE PERFORMANCE

Índices essenciais para consultas de alta performance no calendário e relatórios:

1. `CREATE INDEX idx_bookings_date_room ON public.bookings(booking_date, room_id);`
2. `CREATE INDEX idx_bookings_professional ON public.bookings(professional_id);`
3. `CREATE INDEX idx_bookings_payment_status ON public.bookings(payment_status);`
4. `CREATE INDEX idx_clients_professional ON public.clients(professional_id);`
5. `CREATE INDEX idx_blocked_slots_date ON public.blocked_slots(blocked_date, room_id);`
6. `CREATE INDEX idx_payments_professional ON public.payments(professional_id);`
7. `CREATE INDEX idx_profiles_role ON public.profiles(role);`

---

## 16. STORAGE

**SUPABASE STORAGE NÃO É NECESSÁRIO NO ESTADO ATUAL.**

O aplicativo utiliza exclusivamente ícones vetoriais (`lucide-react`) para identificadores visuais e avatares, não faz upload de fotos de perfil, não armazena anexos de documentos e gera relatórios em PDF diretamente no navegador cliente via `jspdf` e `jspdf-autotable`.

---

## 17. MOCKS E LOCALSTORAGE

Mapeamento exato de todas as estruturas armazenadas localmente para migração:

| Arquivo Fonte | Variável / Chave LocalStorage | Função no Código | Estrutura | Tabela Supabase Correspondente |
| :--- | :--- | :--- | :--- | :--- |
| `storageService.ts` | `locapsico_users_v2` | `getStoredUsers`, `saveStoredUsers` | Array de `User` | `auth.users` + `public.profiles` + `public.professionals` |
| `storageService.ts` | `locapsico_clients_v2` | `getStoredClients`, `saveStoredClients` | Array de `Client` | `public.clients` |
| `storageService.ts` | `locapsico_bookings_v2` | `getStoredBookings`, `saveStoredBookings` | Array de `Booking` | `public.bookings` |
| `storageService.ts` | `locapsico_blocked_v2` | `getStoredBlockedSlots`, `saveStoredBlockedSlots` | Array de `BlockedSlot` | `public.blocked_slots` |
| `storageService.ts` | `locapsico_audit_v2` | `getStoredAuditLogs`, `addAuditLog` | Array de `AuditLog` | `public.audit_logs` |
| `storageService.ts` | `locapsico_config_v2` | `getSystemConfig`, `saveSystemConfig` | Objeto `SystemConfig` | `public.settings` e `public.rooms` |
| `storageService.ts` | `locapsico_session_v2` | `getStoredSession`, `saveStoredSession` | Objeto `User` | Gerenciado pelo `supabase.auth.getSession()` |
| `storageService.ts` | `locapsico_seeded_v2` | `ensureSeededData` | Booleano `'true'` | Eliminado após migration SQL definitiva |

---

## 18. DADOS DE DEMONSTRAÇÃO

### Contas Demo Existentes em `/constants.ts` e `/services/seedData.ts`:

1. **Administrador Geral:**
   - Nome: Dra. Sandra Ramos
   - E-mail: `admin@admin.com.br`
   - Role: `ADMIN`
   - Profissão: Gestora Clínica & Psicóloga (CRP 06/101010)
2. **Profissional 1:**
   - Nome: Dra. Helena Castro
   - E-mail: `helena@psico.com.br`
   - Role: `USER`
   - Profissão: Psicóloga Clínica TCC (CRP 06/123456)
3. **Profissional 2:**
   - Nome: Dr. Bruno Mendes
   - E-mail: `bruno@terapia.com.br`
   - Role: `USER`
   - Profissão: Psicanalista & Terapeuta (CRP 06/987654)
4. **Profissional 3:**
   - Nome: Dra. Camila Rocha
   - E-mail: `camila@saude.com.br`
   - Role: `USER`
   - Profissão: Nutricionista Clínica & Comportamental (CRN 3-45678)

### Clientes Demo:
- 6 pacientes distribuídos entre os profissionais (`cli-1` a `cli-6`).

### Locações Demo:
- 10 agendamentos representativos (`bk-1001` a `bk-1010`) cobrindo locações por hora, período integral, status pago, pendente e histórico passado.

### Bloqueios Demo:
- 2 bloqueios administrativos (`blk-1` na Sala 1 e `blk-2` em todas as salas).

### Regra de Conversão para Seed:
- Os dados de salas (`public.rooms`) e configurações (`public.settings`) devem ser inseridos diretamente via `seed.sql`.
- **Atenção:** Usuários de demonstração NÃO devem ser inseridos como administradores de produção automaticamente; somente o administrador oficial cadastrado com `admin@admin.com.br` receberá role administrativa.

---

## 19. MIGRATION SQL NECESSÁRIA

Abaixo está a especificação completa do DDL que precisará ser executado no Supabase para criar toda a infraestrutura:

```sql
-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABELA: profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  cpf TEXT,
  role TEXT NOT NULL CHECK (role IN ('professional', 'admin')) DEFAULT 'professional',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TABELA: professionals
CREATE TABLE IF NOT EXISTS public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  cpf TEXT,
  professional_type TEXT NOT NULL DEFAULT 'Psicólogo(a)',
  registration_number TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TABELA: clients
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  cpf TEXT,
  birth_date DATE,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. TABELA: rooms
CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 40.00,
  period_rate NUMERIC(10,2) NOT NULL DEFAULT 350.00,
  opening_time INTEGER NOT NULL DEFAULT 7,
  closing_time INTEGER NOT NULL DEFAULT 22,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'MAINTENANCE')) DEFAULT 'ACTIVE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. TABELA: bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  start_time INTEGER NOT NULL CHECK (start_time >= 7 AND start_time < 22),
  end_time INTEGER NOT NULL CHECK (end_time > 7 AND end_time <= 22),
  booking_type TEXT NOT NULL CHECK (booking_type IN ('HOURLY', 'PERIOD')) DEFAULT 'HOURLY',
  total_hours INTEGER NOT NULL,
  hourly_rate NUMERIC(10,2) NOT NULL,
  period_rate NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING', 'PAID', 'CANCELLED')) DEFAULT 'PENDING',
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled', 'completed')) DEFAULT 'confirmed',
  notes TEXT,
  paid_at TIMESTAMPTZ,
  paid_notes TEXT,
  paid_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_booking_hours CHECK (end_time > start_time)
);

-- 7. TABELA: payments
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('PAID', 'PENDING', 'CANCELLED')) DEFAULT 'PAID',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. TABELA: blocked_slots
CREATE TABLE IF NOT EXISTS public.blocked_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  blocked_date DATE NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'Administração Geral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_blocked_hours CHECK (end_time > start_time)
);

-- 9. TABELA: settings
CREATE TABLE IF NOT EXISTS public.settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  establishment_name TEXT NOT NULL DEFAULT 'Espaço Terapêutico & Clínico LocaPsico',
  contact_email TEXT NOT NULL DEFAULT 'contato@locapsico.com.br',
  contact_phone TEXT NOT NULL DEFAULT '(11) 98765-4321',
  open_hour INTEGER NOT NULL DEFAULT 7,
  close_hour INTEGER NOT NULL DEFAULT 22,
  cancellation_limit_hours INTEGER NOT NULL DEFAULT 24,
  allow_holidays_global BOOLEAN NOT NULL DEFAULT false,
  unblocked_holidays TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. TABELA: audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_bookings_date_room ON public.bookings(booking_date, room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_professional ON public.bookings(professional_id);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON public.bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_clients_professional ON public.clients(professional_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date ON public.blocked_slots(blocked_date, room_id);
CREATE INDEX IF NOT EXISTS idx_payments_professional ON public.payments(professional_id);

-- 12. FUNÇÕES E TRIGGERS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_full_name TEXT;
  user_cpf TEXT;
  user_phone TEXT;
  user_profession TEXT;
  user_reg TEXT;
  user_role TEXT;
BEGIN
  user_full_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );
  user_cpf := COALESCE(NEW.raw_user_meta_data->>'cpf', '');
  user_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  user_profession := COALESCE(NEW.raw_user_meta_data->>'profession', 'Psicólogo(a)');
  user_reg := COALESCE(NEW.raw_user_meta_data->>'councilRegistration', NEW.raw_user_meta_data->>'registration_number', '');
  
  IF LOWER(NEW.email) = 'admin@admin.com.br' THEN
    user_role := 'admin';
  ELSE
    user_role := 'professional';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, phone, cpf, role, status)
  VALUES (NEW.id, user_full_name, NEW.email, user_phone, user_cpf, user_role, 'ACTIVE')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, profiles.phone),
      cpf = COALESCE(EXCLUDED.cpf, profiles.cpf);

  INSERT INTO public.professionals (user_id, full_name, email, phone, cpf, professional_type, registration_number, status)
  VALUES (NEW.id, user_full_name, NEW.email, user_phone, user_cpf, user_profession, user_reg, 'ACTIVE')
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, professionals.phone),
      cpf = COALESCE(EXCLUDED.cpf, professionals.cpf),
      professional_type = EXCLUDED.professional_type,
      registration_number = EXCLUDED.registration_number;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.check_booking_conflict()
RETURNS TRIGGER AS $$
BEGIN
  IF EXTRACT(DOW FROM NEW.booking_date) = 0 THEN
    RAISE EXCEPTION 'As salas não são utilizadas aos domingos.';
  END IF;

  IF NEW.payment_status = 'CANCELLED' OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_slots
    WHERE (room_id = 'ALL' OR room_id = NEW.room_id)
      AND blocked_date = NEW.booking_date
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'O horário selecionado está bloqueado pela administração.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE room_id = NEW.room_id
      AND booking_date = NEW.booking_date
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status <> 'CANCELLED'
      AND status <> 'cancelled'
      AND (GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time))
  ) THEN
    RAISE EXCEPTION 'Este horário já está reservado nesta sala.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_booking_conflict ON public.bookings;
CREATE TRIGGER trg_check_booking_conflict
BEFORE INSERT OR UPDATE OF room_id, booking_date, start_time, end_time, booking_type, payment_status, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_conflict();

-- 13. HABILITAÇÃO DE RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 14. POLICIES
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "professionals_select" ON public.professionals FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "professionals_update" ON public.professionals FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (auth.uid() = professional_id OR public.is_admin());
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (auth.uid() = professional_id OR public.is_admin());
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (auth.uid() = professional_id OR public.is_admin());
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (auth.uid() = professional_id OR public.is_admin());

CREATE POLICY "rooms_select" ON public.rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "rooms_admin" ON public.rooms FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "bookings_select" ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings_insert" ON public.bookings FOR INSERT TO authenticated WITH CHECK (auth.uid() = professional_id OR public.is_admin());
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE TO authenticated USING (auth.uid() = professional_id OR public.is_admin());

CREATE POLICY "payments_select" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = professional_id OR public.is_admin());
CREATE POLICY "payments_admin" ON public.payments FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "blocked_slots_select" ON public.blocked_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "blocked_slots_admin" ON public.blocked_slots FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "settings_select" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin" ON public.settings FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
```

---

## 20. FLUXO COMPLETO DOS DADOS

```text
1. CADASTRO
   ↓ Usuário preenche formulário de registro (AuthForms.tsx)
2. AUTH
   ↓ supabase.auth.signUp() cria o registro em auth.users
3. PROFILE
   ↓ Trigger on_auth_user_created insere o usuário em public.profiles (role: professional)
4. PROFISSIONAL
   ↓ Trigger insere dados clínicos complementares em public.professionals
5. CLIENTE
   ↓ Profissional cadastra seus pacientes em public.clients (vinculados ao seu professional_id)
6. CALENDÁRIO
   ↓ Calendar.tsx consulta public.rooms, public.blocked_slots e public.bookings
7. RESERVA
   ↓ Profissional seleciona sala, data, horário e tipo (HOURLY ou PERIOD)
   ↓ Trigger trg_check_booking_conflict valida atomicamente conflitos de agenda
8. PREÇO
   ↓ Sistema congela as tarifas hourly_rate, period_rate e total_amount em public.bookings
9. PAGAMENTO
   ↓ Administrador confirma a liquidação da locação alterando payment_status para 'PAID'
   ↓ Gera lançamento financeiro auditado na tabela public.payments
10. FINANCEIRO
   ↓ UserDashboard e AdminPanel agregam dados de bookings e payments para relatórios e extratos
```

---

## 21. CHECKLIST DE INTEGRAÇÃO

### SUPABASE
- [ ] Projeto Supabase provisionado na região de menor latência (São Paulo / `sa-east-1`).
- [ ] Chaves de API geradas no formato JWT padrão (`eyJ...`).
- [ ] Script DDL executado no SQL Editor com sucesso.

### APP
- [ ] Variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` configuradas.
- [ ] Conexão de inicialização sem erros no console.
- [ ] Limpeza gradual de fallbacks e dados locais obsoletos após migração.

### AUTENTICAÇÃO
- [ ] Cadastro de novos profissionais funcionando com inserção automática em `profiles`.
- [ ] Login funcionando e redirecionando para Início (`UserDashboard`).
- [ ] Perfil de administrador fixado apenas para `admin@admin.com.br`.
- [ ] Bloqueio imediato de contas com status `'INACTIVE'`.

### BANCO
- [ ] 9 tabelas criadas com integridade referencial (`ON DELETE CASCADE / RESTRICT / SET NULL`).
- [ ] Trigger de conflito de agenda ativa e bloqueando sobreposições.
- [ ] Seed inicial de salas (`Sala 1` e `Sala 2`) e configurações globais inserido.

### RLS
- [ ] Row Level Security ativo em todas as 9 tabelas.
- [ ] Teste de isolamento de clientes: Profissional A não consegue ver clientes do Profissional B.
- [ ] Teste de salas: Profissional consegue ler salas mas não alterar tarifas.
- [ ] Teste administrativo: Administrador consegue ler e auditar todas as tabelas.

### CALENDÁRIO
- [ ] Carregamento de ocupação em tempo real.
- [ ] Bloqueio de domingos visual e operacional.
- [ ] Visualização correta dos bloqueios administrativos.

### RESERVAS
- [ ] Criação de reservas horistas (`HOURLY`) com cálculo correto.
- [ ] Criação de reservas de período integral (`PERIOD`) bloqueando o dia inteiro.
- [ ] Congelamento de tarifas preservado em histórico.
- [ ] Cancelamento respeitando a antecedência mínima de 24 horas para profissionais.

### CLIENTES
- [ ] Cadastro, edição e exclusão de pacientes por profissional.
- [ ] Associação opcional de paciente na reserva de sala.

### FINANCEIRO
- [ ] Baixa de pagamentos pelo Administrador.
- [ ] Inserção correspondente em `payments`.
- [ ] Extrato mensal do profissional refletindo valores reais pagos e pendentes.

### ADMIN
- [ ] Painel Geral exibindo métricas globais e resumo financeiro.
- [ ] Gerenciamento de status de profissionais (`ACTIVE` / `INACTIVE`).
- [ ] Gestão de bloqueios administrativos de salas.
- [ ] Edição de tarifas de salas preservando reservas históricas.

### DEPLOY
- [ ] Build de produção (`npm run build`) validado sem erros de compilação.
- [ ] Testes de navegação e responsividade validados em desktop e mobile.

---

## 22. PROBLEMAS / INCONSISTÊNCIAS IDENTIFICADOS NO CÓDIGO ATUAL

Durante a auditoria profunda do código, foram detectadas as seguintes inconsistências que devem ser saneadas na integração definitiva:

### Inconsistência 1: Discrepância de Nomes de Coluna em `profiles`
- **Problema:** O código de fallback em `authService.ts` tentou em certas versões salvar `{ id, nome, email, role }` enquanto a tabela padrão e as consultas usam `full_name`.
- **Arquivo:** `/services/authService.ts` (linhas 95-100 e 245-250).
- **Causa:** Convivência de schemas anteriores (em português) com o schema padrão internacional do Supabase.
- **Impacto:** Risco de `full_name` ficar nulo se o banco esperar `full_name` e o payload enviar `nome`.
- **Solução Recomendada:** Unificar estritamente no código TypeScript para utilizar `full_name` em todas as operações com `public.profiles`.

### Inconsistência 2: Discrepância de Colunas em `bookings` (`professional_id` vs `user_id`)
- **Problema:** Algumas funções do frontend tentaram consultar/inserir `user_id` e `date`, enquanto o schema relacional formal utiliza `professional_id` e `booking_date`.
- **Arquivo:** `/services/bookingService.ts` (linhas 15-40 e 395-440).
- **Causa:** Adaptação rápida para coexistência temporária entre o formato do objeto TypeScript `Booking` (`userId`, `date`, `hour`) e o banco relacional.
- **Impacto:** Necessidade de mapeamento duplo que pode falhar em consultas tipadas.
- **Solução Recomendada:** O mapper `mapDbBookingToBooking` e o payload de inserção devem mapear exclusivamente:
  - `professional_id` $\leftrightarrow$ `userId`
  - `booking_date` $\leftrightarrow$ `date`
  - `start_time` $\leftrightarrow$ `hour`
  - `end_time` $\leftrightarrow$ `endTimeHour`
  - `total_hours` $\leftrightarrow$ `durationHours`
  - `total_amount` $\leftrightarrow$ `totalAmount`
  - `hourly_rate` $\leftrightarrow$ `priceAtBooking`

### Inconsistência 3: Chaves em `.env.example`
- **Problema:** O arquivo `.env.example` continha valores de produção pré-configurados que poderiam induzir à sobreposição de chaves inválidas.
- **Arquivo:** `/.env.example`.
- **Causa:** Configuração inicial de demonstração.
- **Impacto:** Sanitização de URL exigida em tempo de execução para prevenir crash de inicialização.
- **Solução Recomendada:** Manter placeholders explícitos em `.env.example` para documentar que os valores devem ser obtidos no painel do Supabase do usuário.

---

## 23. RESUMO FINAL

A tabela abaixo sintetiza todos os componentes e artefatos necessários para a integração real:

| ITEM | NECESSÁRIO? | NOME | OBSERVAÇÃO |
| :--- | :--- | :--- | :--- |
| **Supabase Auth** | Sim | `auth.users` | Gestão segura de identidade, sessões JWT e senhas criptografadas |
| **Supabase Database** | Sim | PostgreSQL 15+ | Banco de dados relacional principal |
| **Supabase Storage** | **NÃO** | N/A | **SUPABASE STORAGE NÃO É NECESSÁRIO NO ESTADO ATUAL.** |
| **Variável URL** | Sim | `VITE_SUPABASE_URL` | URL do projeto Supabase |
| **Variável Anon Key** | Sim | `VITE_SUPABASE_ANON_KEY` | Chave pública JWT do projeto |
| **Tabela Profiles** | Sim | `public.profiles` | Perfil de usuário vinculado ao Auth (role, status, contato) |
| **Tabela Professionals**| Sim | `public.professionals`| Cadastro clínico e conselho profissional (CRP/CRM) |
| **Tabela Clients** | Sim | `public.clients` | Pacientes particulares (privacidade estrita por profissional) |
| **Tabela Rooms** | Sim | `public.rooms` | Salas clínicas (`Sala 1` e `Sala 2`), limites e tarifas |
| **Tabela Bookings** | Sim | `public.bookings` | Agendamentos com congelamento histórico de valor |
| **Tabela Payments** | Sim | `public.payments` | Histórico e auditoria de quitações financeiras |
| **Tabela Blocked Slots**| Sim | `public.blocked_slots`| Bloqueios operacionais da agenda |
| **Tabela Settings** | Sim | `public.settings` | Configurações globais da clínica |
| **Tabela Audit Logs** | Sim | `public.audit_logs` | Rastreabilidade e log de ações administrativas e de usuários |
| **RLS (Row Level Security)**| Sim | Policies em todas as 9 tabelas | Garantia de segurança e sigilo de dados entre profissionais |
| **Functions / RPC** | Sim | `is_admin()`, `handle_new_user()` | Funções auxiliares de controle de perfil e segurança |
| **Triggers** | Sim | `trg_check_booking_conflict` | Prevenção atômica de reservas sobrepostas e conflitos |
| **Triggers** | Sim | `on_auth_user_created` | Criação automática de perfil e profissional no cadastro |
| **Indexes** | Sim | 7 índices principais | Otimização para consultas de data, sala e profissional |
| **Seed** | Sim | `seed.sql` | Carga inicial de `rooms` (`Sala 1`, `Sala 2`) e `settings` |

---

*Manifesto gerado e revisado conforme as diretrizes de integridade, confidencialidade médica e estabilidade técnica do LocaPsico.*
