/**
 * BATERIA DE TESTES AUTOMATIZADOS - ENDPOINT DE RESTAURAÇÃO CLOUDFLARE PAGES
 * Arquivo: test/restoreEndpoint.test.ts
 *
 * Testa isoladamente `functions/api/admin/restore.ts` utilizando mocks do Supabase e simulações de falhas.
 * NENHUM banco de dados real ou rede remota é acessado ou modificado.
 */

import { onRequestPost, PRODUCTION_PROJECT_REF, PagesFunctionContext, Env } from '../functions/api/admin/restore';
import { SystemBackupPayload } from '../scripts/backupValidation';

export async function runRestoreEndpointTests(): Promise<{ total: number; passed: number; failures: string[] }> {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${detail || 'Condição não satisfeita'}`);
      failures.push(testName);
    }
  }

  console.log('\n================================================================');
  console.log('TESTES DO ENDPOINT DE RESTAURAÇÃO (CLOUDFLARE PAGES /api/admin/restore)');
  console.log('================================================================');

  const validAdminId = '11111111-1111-4111-8111-111111111111';
  const validAdminEmail = 'admin@admin.com.br';
  const validProfId = '22222222-2222-4222-8222-222222222222';
  const validClientId = '33333333-3333-4333-8333-333333333333';
  const validBookingId = '44444444-4444-4444-8444-444444444444';
  const validPaymentId = '55555555-5555-4555-8555-555555555555';
  const validBlockedSlotId = '66666666-6666-4666-8666-666666666666';
  const validAuditLogId = '77777777-7777-4777-8777-777777777777';

  const createValidBackup = (): SystemBackupPayload => ({
    metadata: {
      system: 'LocaPsico',
      backupType: 'COMPLETO',
      isAnonymized: false,
      restorable: true,
      description: 'Backup completo de homologação para testes automatizados',
      schemaVersion: '1.1',
      generatedAt: '2026-10-23T12:00:00.000Z',
      generatedBy: {
        id: validAdminId,
        email: validAdminEmail,
        name: 'Administrador Geral'
      },
      totalRecords: 9,
      counts: {
        profiles: 2,
        professionals: 1,
        clients: 1,
        rooms: 2,
        bookings: 1,
        payments: 1,
        blocked_slots: 1,
        settings: 1,
        audit_logs: 1
      }
    },
    data: {
      profiles: [
        {
          id: validAdminId,
          full_name: 'Administrador Geral',
          email: validAdminEmail,
          role: 'admin',
          status: 'ACTIVE'
        },
        {
          id: validProfId,
          full_name: 'Dra. Ana Paula',
          email: 'ana@clinica.com.br',
          role: 'professional',
          status: 'ACTIVE'
        }
      ],
      professionals: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          user_id: validProfId,
          full_name: 'Dra. Ana Paula',
          status: 'ACTIVE'
        }
      ],
      clients: [
        {
          id: validClientId,
          professional_id: validProfId,
          full_name: 'Paciente Teste',
          status: 'ACTIVE'
        }
      ],
      rooms: [
        {
          id: 'Sala 1',
          name: 'Sala 1 — Individual',
          hourly_rate: 40,
          opening_time: 7,
          closing_time: 22,
          status: 'ACTIVE'
        },
        {
          id: 'Sala 2',
          name: 'Sala 2 — Multidisciplinar',
          hourly_rate: 45,
          opening_time: 7,
          closing_time: 22,
          status: 'ACTIVE'
        }
      ],
      bookings: [
        {
          id: validBookingId,
          professional_id: validProfId,
          client_id: validClientId,
          room_id: 'Sala 1',
          booking_date: '2026-10-25',
          start_time: 8,
          end_time: 10,
          booking_type: 'HOURLY',
          status: 'confirmed',
          payment_status: 'PAID',
          total_amount: 80
        }
      ],
      payments: [
        {
          id: validPaymentId,
          professional_id: validProfId,
          booking_id: validBookingId,
          amount: 80,
          status: 'PAID'
        }
      ],
      blocked_slots: [
        {
          id: validBlockedSlotId,
          room_id: 'Sala 1',
          blocked_date: '2026-11-02',
          start_time: 7,
          end_time: 22,
          reason: 'Feriado'
        }
      ],
      settings: [
        {
          id: 'global',
          establishment_name: 'Espaço LocaPsico'
        }
      ],
      audit_logs: [
        {
          id: validAuditLogId,
          user_id: validAdminId,
          action: 'Inicialização',
          timestamp: '2026-10-23T10:00:00.000Z'
        }
      ]
    }
  });

  /**
   * Construtor de mock flexível do cliente Supabase para controle de cenários e falhas simuladas
   */
  function createMockSupabase(overrides: {
    getUserResult?: { user?: any; error?: any };
    profileResult?: { profile?: any; error?: any };
    listUsersResult?: { users?: any[]; error?: any };
    createUserResult?: (params: any) => { user?: any; error?: any };
    deleteUserResult?: (uid: string) => { error?: any };
    rpcResult?: { data?: any; error?: any };
    tableDeleteError?: Record<string, any>;
    tableUpsertError?: Record<string, any>;
    tableInsertError?: Record<string, any>;
    initialData?: Record<string, any[]>;
  }) {
    const deletedAuthUserIds: string[] = [];
    const createdAuthUserIds: string[] = [];
    const mutatedTables: string[] = [];

    const mockClient: any = {
      _tracking: {
        deletedAuthUserIds,
        createdAuthUserIds,
        mutatedTables
      },
      auth: {
        getUser: async (_token: string) => {
          if (overrides.getUserResult?.error) {
            return { data: { user: null }, error: overrides.getUserResult.error };
          }
          return {
            data: {
              user: overrides.getUserResult?.user || {
                id: validAdminId,
                email: validAdminEmail
              }
            },
            error: null
          };
        },
        admin: {
          listUsers: async () => {
            if (overrides.listUsersResult?.error) {
              return { data: { users: [] }, error: overrides.listUsersResult.error };
            }
            return {
              data: {
                users: overrides.listUsersResult?.users || [
                  { id: validAdminId, email: validAdminEmail }
                ]
              },
              error: null
            };
          },
          createUser: async (params: any) => {
            createdAuthUserIds.push(params.id);
            if (overrides.createUserResult) {
              const res = overrides.createUserResult(params);
              if (res.error) return { data: { user: null }, error: res.error };
              return { data: { user: res.user || { id: params.id, email: params.email } }, error: null };
            }
            return { data: { user: { id: params.id, email: params.email } }, error: null };
          },
          deleteUser: async (uid: string) => {
            deletedAuthUserIds.push(uid);
            if (overrides.deleteUserResult) {
              const res = overrides.deleteUserResult(uid);
              return { data: {}, error: res.error || null };
            }
            return { data: {}, error: null };
          }
        }
      },
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'execute_admin_full_restore') {
          if (overrides.rpcResult) {
            return overrides.rpcResult;
          }
          return {
            data: {
              success: true,
              restored_at: new Date().toISOString(),
              total_records: 9,
              counts: {
                profiles: 2,
                professionals: 1,
                clients: 1,
                rooms: 2,
                bookings: 1,
                payments: 1,
                blocked_slots: 1,
                settings: 1,
                audit_logs: 2
              }
            },
            error: null
          };
        }
        return { data: null, error: { message: `RPC ${fnName} not mocked` } };
      },
      from: (table: string) => {
        return {
          select: (_fields?: string) => ({
            eq: (_col: string, _val: any) => ({
              maybeSingle: async () => {
                if (overrides.profileResult?.error) {
                  return { data: null, error: overrides.profileResult.error };
                }
                return {
                  data: overrides.profileResult?.profile !== undefined
                    ? overrides.profileResult.profile
                    : { id: validAdminId, email: validAdminEmail, role: 'admin', full_name: 'Administrador Geral' },
                  error: null
                };
              }
            }),
            order: () => Promise.resolve({ data: overrides.initialData?.[table] || [] }),
            then: (resolve: any) => resolve({ data: overrides.initialData?.[table] || [] })
          }),
          delete: () => {
            mutatedTables.push(`${table}:delete`);
            return {
              not: () => {
                if (overrides.tableDeleteError?.[table]) {
                  return Promise.reject(overrides.tableDeleteError[table]);
                }
                return Promise.resolve({ data: null, error: null });
              },
              eq: () => Promise.resolve({ data: null, error: null })
            };
          },
          upsert: async (rows: any) => {
            mutatedTables.push(`${table}:upsert`);
            if (overrides.tableUpsertError?.[table]) {
              return { data: null, error: overrides.tableUpsertError[table] };
            }
            return { data: rows, error: null };
          },
          insert: async (rows: any) => {
            mutatedTables.push(`${table}:insert`);
            if (overrides.tableInsertError?.[table]) {
              return { data: null, error: overrides.tableInsertError[table] };
            }
            return { data: rows, error: null };
          }
        };
      }
    };

    return mockClient;
  }

  function createMockContext(params: {
    headers?: Record<string, string>;
    body?: any;
    env?: Partial<Env>;
    mockClient?: any;
  }): PagesFunctionContext<Env> {
    const headers = new Headers();
    if (params.headers) {
      for (const [k, v] of Object.entries(params.headers)) {
        headers.set(k, v);
      }
    }

    const request = new Request('https://locapsico.local/api/admin/restore', {
      method: 'POST',
      headers,
      body: params.body !== undefined ? JSON.stringify(params.body) : undefined
    });

    const env: Env = {
      SUPABASE_URL: params.env?.SUPABASE_URL || 'https://staging-test-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: params.env?.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-key-for-test',
      ...params.env
    };

    return {
      request,
      env,
      params: {},
      waitUntil: () => {},
      next: async () => new Response(),
      data: {
        supabaseAdmin: params.mockClient
      }
    };
  }

  // =========================================================================
  // GRUPO 1: AUTENTICAÇÃO E CABEÇALHOS BEARER
  // =========================================================================
  console.log('\nGrupo 1: Autenticação e Cabeçalho Bearer');

  // 1. Header Bearer Ausente
  const ctxNoAuth = createMockContext({
    headers: {},
    body: { confirmationWord: 'RESTAURAR' },
    mockClient: createMockSupabase({})
  });
  const resNoAuth = await onRequestPost(ctxNoAuth);
  const jsonNoAuth = await resNoAuth.json() as any;
  assert(resNoAuth.status === 401 && jsonNoAuth.error?.includes('Bearer ausente'),
    '1. Rejeita com HTTP 401 quando o cabeçalho Authorization está ausente');

  // 2. Token Bearer Vazio
  const ctxEmptyToken = createMockContext({
    headers: { Authorization: 'Bearer ' },
    body: { confirmationWord: 'RESTAURAR' },
    mockClient: createMockSupabase({})
  });
  const resEmptyToken = await onRequestPost(ctxEmptyToken);
  const jsonEmptyToken = await resEmptyToken.json() as any;
  assert(resEmptyToken.status === 401 && jsonEmptyToken.error?.includes('vazio ou malformado'),
    '2. Rejeita com HTTP 401 quando o token Bearer é uma string vazia');

  // 3. Sessão Inválida / Expirada no Supabase Auth
  const ctxInvalidSession = createMockContext({
    headers: { Authorization: 'Bearer token-invalido' },
    body: { confirmationWord: 'RESTAURAR' },
    mockClient: createMockSupabase({
      getUserResult: { error: { message: 'Token expired' } }
    })
  });
  const resInvalidSession = await onRequestPost(ctxInvalidSession);
  const jsonInvalidSession = await resInvalidSession.json() as any;
  assert(resInvalidSession.status === 401 && jsonInvalidSession.error?.includes('inválida ou expirada'),
    '3. Rejeita com HTTP 401 quando o Supabase Auth indica sessão expirada/inválida');

  // =========================================================================
  // GRUPO 2: AUTORIZAÇÃO ADMINISTRATIVA (RBAC)
  // =========================================================================
  console.log('\nGrupo 2: Autorização Administrativa (RBAC)');

  // 4. Erro ao consultar perfil administrativo no banco
  const ctxProfileDbErr = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR' },
    mockClient: createMockSupabase({
      profileResult: { error: { message: 'DB connection error' } }
    })
  });
  const resProfileDbErr = await onRequestPost(ctxProfileDbErr);
  const jsonProfileDbErr = await resProfileDbErr.json() as any;
  assert(resProfileDbErr.status === 500 && jsonProfileDbErr.error?.includes('Falha ao consultar perfil'),
    '4. Retorna HTTP 500 caso ocorra falha de leitura do perfil do executor no banco');

  // 5. Usuário autenticado que NÃO é administrador (role = 'professional')
  const ctxNonAdmin = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR' },
    mockClient: createMockSupabase({
      profileResult: { profile: { id: validAdminId, role: 'professional' } }
    })
  });
  const resNonAdmin = await onRequestPost(ctxNonAdmin);
  const jsonNonAdmin = await resNonAdmin.json() as any;
  assert(resNonAdmin.status === 403 && jsonNonAdmin.error?.includes('Apenas administradores'),
    '5. Rejeita com HTTP 403 quando o usuário possui role diferente de admin');

  // =========================================================================
  // GRUPO 3: PALAVRA DE CONFIRMAÇÃO E BARREIRA DE PRODUÇÃO
  // =========================================================================
  console.log('\nGrupo 3: Palavra de Confirmação e Barreira de Produção');

  // 6. Palavra de confirmação incorreta
  const ctxBadConfirmation = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'SIM', backup: createValidBackup() },
    mockClient: createMockSupabase({})
  });
  const resBadConfirmation = await onRequestPost(ctxBadConfirmation);
  const jsonBadConfirmation = await resBadConfirmation.json() as any;
  assert(resBadConfirmation.status === 400 && jsonBadConfirmation.error?.includes('Palavra de confirmação inválida'),
    '6. Rejeita com HTTP 400 caso a palavra de confirmação não seja RESTAURAR');

  // 7. Barreira de Segurança de Produção
  const ctxProdGuard = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    env: { SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
    mockClient: createMockSupabase({})
  });
  const resProdGuard = await onRequestPost(ctxProdGuard);
  const jsonProdGuard = await resProdGuard.json() as any;
  assert(resProdGuard.status === 403 && jsonProdGuard.error?.includes('BLOQUEIO DE SEGURANÇA'),
    '7. Bloqueia incondicionalmente com HTTP 403 requisições direcionadas ao projeto de produção');

  // =========================================================================
  // GRUPO 4: VALIDAÇÃO PRÉVIA (ZERO MUTAÇÕES ANTES DA VALIDAÇÃO)
  // =========================================================================
  console.log('\nGrupo 4: Rejeição Prévia de Backups Inválidos / Incompletos');

  // 8. Rejeição de Backup com tabela ausente
  const mockTrackingClient8 = createMockSupabase({});
  const invalidBackupMissingTable = createValidBackup();
  delete (invalidBackupMissingTable.data as any).payments;

  const ctxInvalidBackup = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: invalidBackupMissingTable },
    mockClient: mockTrackingClient8
  });
  const resInvalidBackup = await onRequestPost(ctxInvalidBackup);
  const jsonInvalidBackup = await resInvalidBackup.json() as any;
  assert(
    resInvalidBackup.status === 400 &&
    mockTrackingClient8._tracking.mutatedTables.length === 0 &&
    mockTrackingClient8._tracking.createdAuthUserIds.length === 0,
    '8. Rejeita backup incompleto com HTTP 400 com garantia de zero mutações no banco e no Auth'
  );

  // 8b. Rejeição de Backup Anonimizado
  const mockTrackingClient8b = createMockSupabase({});
  const anonBackup = createValidBackup();
  anonBackup.metadata.isAnonymized = true;

  const ctxAnonBackup = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: anonBackup },
    mockClient: mockTrackingClient8b
  });
  const resAnonBackup = await onRequestPost(ctxAnonBackup);
  const jsonAnonBackup = await resAnonBackup.json() as any;
  assert(
    resAnonBackup.status === 400 &&
    jsonAnonBackup.error?.includes('Backup Anonimizado') &&
    mockTrackingClient8b._tracking.mutatedTables.length === 0,
    '8b. Rejeita backup anonimizado com HTTP 400 antes de qualquer operação destrutiva'
  );

  // =========================================================================
  // GRUPO 5: FLUXO DE SUCESSO VIA RPC ATÔMICA POSTGRESQL
  // =========================================================================
  console.log('\nGrupo 5: Fluxo de Sucesso via RPC Atômica (PostgreSQL)');

  const mockRpcSuccessClient = createMockSupabase({
    listUsersResult: {
      users: [
        { id: validAdminId, email: validAdminEmail },
        { id: validProfId, email: 'ana@clinica.com.br' }
      ]
    },
    rpcResult: {
      data: {
        success: true,
        restored_at: '2026-10-23T12:00:00.000Z',
        total_records: 10,
        counts: {
          profiles: 2,
          professionals: 1,
          clients: 1,
          rooms: 2,
          bookings: 1,
          payments: 1,
          blocked_slots: 1,
          settings: 1,
          audit_logs: 2
        }
      },
      error: null
    }
  });

  const ctxRpcSuccess = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    mockClient: mockRpcSuccessClient
  });
  const resRpcSuccess = await onRequestPost(ctxRpcSuccess);
  const jsonRpcSuccess = await resRpcSuccess.json() as any;

  assert(
    resRpcSuccess.status === 200 &&
    jsonRpcSuccess.success === true &&
    jsonRpcSuccess.counts?.bookings === 1 &&
    jsonRpcSuccess.message?.includes('atomicidade garantida'),
    '9. Executa restauração atômica via RPC PostgreSQL retornando HTTP 200 com resumo consolidado'
  );

  // =========================================================================
  // GRUPO 6: FLUXO DE SUCESSO VIA FALLBACK DE CONTINGÊNCIA (RPC 42883)
  // =========================================================================
  console.log('\nGrupo 6: Fluxo de Sucesso via Fallback de Contingência');

  const mockFallbackSuccessClient = createMockSupabase({
    listUsersResult: {
      users: [
        { id: validAdminId, email: validAdminEmail },
        { id: validProfId, email: 'ana@clinica.com.br' }
      ]
    },
    rpcResult: {
      data: null,
      error: { code: '42883', message: 'function execute_admin_full_restore does not exist' }
    }
  });

  const ctxFallbackSuccess = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    mockClient: mockFallbackSuccessClient
  });
  const resFallbackSuccess = await onRequestPost(ctxFallbackSuccess);
  const jsonFallbackSuccess = await resFallbackSuccess.json() as any;

  assert(
    resFallbackSuccess.status === 200 &&
    jsonFallbackSuccess.success === true &&
    mockFallbackSuccessClient._tracking.mutatedTables.some(t => t.includes('bookings:upsert')),
    '10. Executa restauração cliente ordenada com sucesso quando a RPC não está instalada no banco'
  );

  // =========================================================================
  // GRUPO 7: TRATAMENTO DE FALHA NO SUPABASE AUTH E COMPENSAÇÃO ISOLADA
  // =========================================================================
  console.log('\nGrupo 7: Supabase Auth - Criação e Compensação em Falhas');

  // 11. Falha ao criar usuário no Auth aciona rollback compensatório sem tocar no banco
  let createAttempt = 0;
  const mockAuthFailureClient = createMockSupabase({
    listUsersResult: {
      users: [{ id: validAdminId, email: validAdminEmail }] // Dra. Ana não existe
    },
    createUserResult: (params: any) => {
      createAttempt++;
      if (createAttempt === 1) {
        return { user: { id: params.id, email: params.email } };
      }
      return { error: { message: 'Auth rate limit exceeded' } };
    }
  });

  // Criamos backup com 2 usuários novos além do admin
  const backupWithTwoNewUsers = createValidBackup();
  backupWithTwoNewUsers.data.profiles.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    full_name: 'Dr. Segundo Novo',
    email: 'segundo@clinica.com.br',
    role: 'professional',
    status: 'ACTIVE'
  });

  const ctxAuthFailure = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: backupWithTwoNewUsers },
    mockClient: mockAuthFailureClient
  });
  const resAuthFailure = await onRequestPost(ctxAuthFailure);
  const jsonAuthFailure = await resAuthFailure.json() as any;

  assert(
    resAuthFailure.status === 500 &&
    jsonAuthFailure.error?.includes('Falha ao provisionar usuário') &&
    mockAuthFailureClient._tracking.deletedAuthUserIds.length >= 1 &&
    mockAuthFailureClient._tracking.mutatedTables.length === 0,
    '11. Falha no Supabase Auth dispara compensação/exclusão das contas criadas e preserva o banco'
  );

  // 12. Usuários existentes no Auth não são recriados nem têm senhas alteradas
  const mockAuthExistingClient = createMockSupabase({
    listUsersResult: {
      users: [
        { id: validAdminId, email: validAdminEmail },
        { id: validProfId, email: 'ana@clinica.com.br' }
      ]
    }
  });

  const ctxAuthExisting = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    mockClient: mockAuthExistingClient
  });
  await onRequestPost(ctxAuthExisting);

  assert(
    mockAuthExistingClient._tracking.createdAuthUserIds.length === 0,
    '12. Usuários que já constam no Supabase Auth mantêm suas credenciais sem novas criações'
  );

  // =========================================================================
  // GRUPO 8: FALHAS NA RESTAURAÇÃO E SIMULAÇÃO DE ROLLBACK
  // =========================================================================
  console.log('\nGrupo 8: Simulação de Falhas e Integridade de Rollback');

  // 13. Falha na restauração com rollback bem-sucedido (estado anterior preservado)
  const mockRollbackSuccessClient = createMockSupabase({
    rpcResult: {
      data: null,
      error: { code: '42883', message: 'function does not exist' }
    },
    initialData: {
      settings: [{ id: 'setting-1', timezone: 'America/Sao_Paulo' }]
    },
    tableUpsertError: {
      // Simula falha na fase de inserção do fallback na tabela 'bookings'
      bookings: { message: 'Simulated foreign key failure on bookings' }
    }
  });

  const ctxRollbackSuccess = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    mockClient: mockRollbackSuccessClient
  });
  const resRollbackSuccess = await onRequestPost(ctxRollbackSuccess);
  const jsonRollbackSuccess = await resRollbackSuccess.json() as any;

  assert(
    resRollbackSuccess.status === 500 &&
    jsonRollbackSuccess.error?.includes('estado anterior preservado'),
    '13. Quando o rollback do snapshot é bem-sucedido, informa que o estado anterior foi preservado'
  );

  // 14. Falha no rollback do snapshot (defeito comprovado e agora tratado com transparência total)
  let upsertCountSettings = 0;
  const mockRollbackFailureClient = createMockSupabase({
    rpcResult: {
      data: null,
      error: { code: '42883', message: 'function does not exist' }
    },
    initialData: {
      settings: [{ id: 'setting-1', timezone: 'America/Sao_Paulo' }]
    },
    tableUpsertError: {
      bookings: { message: 'Database corruption on bookings insert' }
    }
  });

  // Intercepta a tabela 'settings' para falhar durante a fase de rollback do snapshot
  const originalFrom = mockRollbackFailureClient.from;
  mockRollbackFailureClient.from = (table: string) => {
    const tableObj = originalFrom(table);
    if (table === 'settings') {
      return {
        ...tableObj,
        upsert: async () => {
          upsertCountSettings++;
          if (upsertCountSettings >= 2) {
            // Falha proposital na fase de rollback!
            return { data: null, error: { message: 'Hard disk full during rollback settings upsert' } };
          }
          return { data: {}, error: null };
        }
      };
    }
    return tableObj;
  };

  const ctxRollbackFailure = createMockContext({
    headers: { Authorization: 'Bearer token-valido' },
    body: { confirmationWord: 'RESTAURAR', backup: createValidBackup() },
    mockClient: mockRollbackFailureClient
  });
  const resRollbackFailure = await onRequestPost(ctxRollbackFailure);
  const jsonRollbackFailure = await resRollbackFailure.json() as any;

  assert(
    resRollbackFailure.status === 500 &&
    jsonRollbackFailure.error?.includes('não é possível garantir a recuperação integral do estado anterior'),
    '14. Quando ocorre falha no rollback, a resposta informa expressamente que não é possível garantir a recuperação integral'
  );

  return { total, passed, failures };
}
