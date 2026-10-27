/**
 * Bateria de Testes Automatizados - Validação Estrita de Backup e Restauração
 * Arquivo: test/backupValidation.test.ts
 */

import {
  validateFullBackupPayload,
  detectAnonymizedBackup,
  detectForbiddenCredentials,
  isValidUUID,
  isValidDateString,
  sanitizeCredentialsDeep,
  SystemBackupPayload
} from '../scripts/backupValidation';

export function runBackupValidationTests(): { total: number; passed: number; failures: string[] } {
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
  console.log('TESTES DE VALIDAÇÃO EST RITA DE BACKUP E RESTAURAÇÃO (PRÉ-EXECUÇÃO)');
  console.log('================================================================');

  const validAdminId = '11111111-1111-4111-8111-111111111111';
  const validProfId = '22222222-2222-4222-8222-222222222222';
  const validClientId = '33333333-3333-4333-8333-333333333333';
  const validBookingId = '44444444-4444-4444-8444-444444444444';
  const validPaymentId = '55555555-5555-4555-8555-555555555555';
  const validBlockedSlotId = '66666666-6666-4666-8666-666666666666';
  const validAuditLogId = '77777777-7777-4777-8777-777777777777';

  const createValidBackupPayload = (): SystemBackupPayload => ({
    metadata: {
      system: 'LocaPsico',
      backupType: 'COMPLETO',
      isAnonymized: false,
      restorable: true,
      description: 'Backup completo de teste',
      schemaVersion: '1.1',
      generatedAt: '2026-10-23T12:00:00.000Z',
      generatedBy: {
        id: validAdminId,
        email: 'admin@locapsico.com.br',
        name: 'Administrador Principal'
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
          email: 'admin@locapsico.com.br',
          role: 'admin',
          status: 'ACTIVE'
        },
        {
          id: validProfId,
          full_name: 'Dr. Roberto Psicólogo',
          email: 'roberto@clinica.com.br',
          role: 'professional',
          status: 'ACTIVE'
        }
      ],
      professionals: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          user_id: validProfId,
          full_name: 'Dr. Roberto Psicólogo',
          status: 'ACTIVE'
        }
      ],
      clients: [
        {
          id: validClientId,
          professional_id: validProfId,
          full_name: 'Paciente Exemplo',
          status: 'ACTIVE'
        }
      ],
      rooms: [
        {
          id: 'Sala 1',
          name: 'Sala 1 — Atendimento Individual',
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
          start_time: 9,
          end_time: 11,
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
          room_id: 'ALL',
          blocked_date: '2026-12-25',
          start_time: 7,
          end_time: 22,
          reason: 'Feriado de Natal'
        }
      ],
      settings: [
        {
          id: 'global',
          establishment_name: 'LocaPsico Centro de Psicologia'
        }
      ],
      audit_logs: [
        {
          id: validAuditLogId,
          user_id: validAdminId,
          action: 'Criação de Sala',
          timestamp: '2026-10-23T10:00:00.000Z'
        }
      ]
    }
  });

  // 1. Payload Válido
  const validRes = validateFullBackupPayload(createValidBackupPayload());
  assert(validRes.valid === true, '1. Payload válido completo é aceito com sucesso sem erros');
  assert(validRes.counts?.bookings === 1, '1b. Contagens de registros são computadas corretamente');

  // 2. rooms.id como TEXT e settings.id como TEXT são aceitos
  assert(
    !validRes.errors.some(e => e.includes('Sala 1') || e.includes('global')),
    '2. rooms.id ("Sala 1") e settings.id ("global") são aceitos como strings identificadoras (não exigem UUID)'
  );

  // 3. Rejeição de Não-Objeto
  assert(validateFullBackupPayload(null).valid === false, '3. Payload nulo é rejeitado');
  assert(validateFullBackupPayload('string').valid === false, '3b. Payload string é rejeitado');

  // 4. Rejeição de Sistema Incompatível
  const wrongSystem = createValidBackupPayload();
  wrongSystem.metadata.system = 'OutroSistema';
  const wrongSysRes = validateFullBackupPayload(wrongSystem);
  assert(wrongSysRes.valid === false && wrongSysRes.error?.includes('não é o LocaPsico') === true,
    '4. Sistema diferente de "LocaPsico" é rejeitado');

  // 5. Rejeição Estrita de Backup Anonimizado
  const anonMetaPayload = createValidBackupPayload();
  anonMetaPayload.metadata.isAnonymized = true;
  assert(validateFullBackupPayload(anonMetaPayload).valid === false, '5a. isAnonymized: true é rejeitado');

  const anonTypePayload = createValidBackupPayload();
  anonTypePayload.metadata.backupType = 'ANONIMIZADO';
  assert(validateFullBackupPayload(anonTypePayload).valid === false, '5b. backupType: ANONIMIZADO é rejeitado');

  const anonDataPayload = createValidBackupPayload();
  anonDataPayload.data.profiles[0].email = 'admin@anonimizado.local';
  assert(validateFullBackupPayload(anonDataPayload).valid === false, '5c. Email @anonimizado.local em registros é detectado e bloqueado');

  const anonCpfPayload = createValidBackupPayload();
  anonCpfPayload.data.profiles[0].cpf = '***.***.***-**';
  assert(validateFullBackupPayload(anonCpfPayload).valid === false, '5d. CPF mascarado ***.***.***-** em registros é detectado e bloqueado');

  // 6. Rejeição de Credenciais Proibidas
  const credPayload = createValidBackupPayload();
  (credPayload.data.profiles[0] as any).password_hash = 'secret_hash_value';
  const credRes = validateFullBackupPayload(credPayload);
  assert(credRes.valid === false && credRes.error?.includes('password_hash') === true,
    '6. Campo sensível proibido (password_hash) é detectado e rejeitado');

  // 7. Rejeição de Tabela Ausente
  const missingTablePayload = createValidBackupPayload();
  delete (missingTablePayload.data as any).payments;
  const missingTableRes = validateFullBackupPayload(missingTablePayload);
  assert(missingTableRes.valid === false && missingTableRes.error?.includes('payments') === true,
    '7. Ausência de tabela obrigatória (payments) é detectada e rejeitada');

  // 8. Rejeição de UUID Corrompido
  const badUuidPayload = createValidBackupPayload();
  badUuidPayload.data.profiles[1].id = 'id-invalido-nao-uuid';
  const badUuidRes = validateFullBackupPayload(badUuidPayload);
  assert(badUuidRes.valid === false && badUuidRes.errors.some(e => e.includes('profiles[1].id')),
    '8. profiles.id corrompido/não-UUID é detectado e rejeitado');

  // 9. Unicidade de professionals.user_id
  const duplicateProfUserPayload = createValidBackupPayload();
  duplicateProfUserPayload.data.professionals.push({
    id: '99999999-9999-4999-8999-999999999999',
    user_id: validProfId, // Duplicado!
    full_name: 'Dr. Roberto Psicólogo Duplicado',
    status: 'ACTIVE'
  });
  const dupProfRes = validateFullBackupPayload(duplicateProfUserPayload);
  assert(dupProfRes.valid === false && dupProfRes.errors.some(e => e.includes('duplicado') && e.includes('professionals')),
    '9. professionals.user_id duplicado é detectado como violação de unicidade');

  // 10. Integridade Referencial: professional_id inexistente em profiles
  const orphanProfPayload = createValidBackupPayload();
  orphanProfPayload.data.professionals[0].user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const orphanProfRes = validateFullBackupPayload(orphanProfPayload);
  assert(orphanProfRes.valid === false && orphanProfRes.errors.some(e => e.includes('não existe na tabela profiles')),
    '10. professionals.user_id sem profile correspondente é rejeitado');

  // 11. Integridade Referencial: clients.professional_id inexistente em profiles
  const orphanClientPayload = createValidBackupPayload();
  orphanClientPayload.data.clients[0].professional_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const orphanClientRes = validateFullBackupPayload(orphanClientPayload);
  assert(orphanClientRes.valid === false && orphanClientRes.errors.some(e => e.includes('clients[0].professional_id')),
    '11. clients.professional_id sem profile correspondente é rejeitado');

  // 12. Integridade Referencial: bookings.room_id inexistente em rooms
  const badRoomBookingPayload = createValidBackupPayload();
  badRoomBookingPayload.data.bookings[0].room_id = 'Sala Inexistente 99';
  const badRoomBookingRes = validateFullBackupPayload(badRoomBookingPayload);
  assert(badRoomBookingRes.valid === false && badRoomBookingRes.errors.some(e => e.includes('bookings[0].room_id')),
    '12. bookings.room_id apontando para sala inexistente é rejeitado');

  // 13. Integridade Referencial: bookings.client_id inexistente em clients
  const orphanBookingClientPayload = createValidBackupPayload();
  orphanBookingClientPayload.data.bookings[0].client_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const orphanBookingClientRes = validateFullBackupPayload(orphanBookingClientPayload);
  assert(orphanBookingClientRes.valid === false && orphanBookingClientRes.errors.some(e => e.includes('bookings[0].client_id')),
    '13. bookings.client_id não encontrado em clients é rejeitado sem anulação silenciosa');

  // 14. Integridade Referencial: payments.booking_id inexistente em bookings
  const orphanPayBookingPayload = createValidBackupPayload();
  orphanPayBookingPayload.data.payments[0].booking_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const orphanPayRes = validateFullBackupPayload(orphanPayBookingPayload);
  assert(orphanPayRes.valid === false && orphanPayRes.errors.some(e => e.includes('payments[0].booking_id')),
    '14. payments.booking_id não encontrado em bookings é rejeitado sem anulação silenciosa');

  // 15. Validação de Regras de Horário em Bookings
  const badHoursPayload = createValidBackupPayload();
  badHoursPayload.data.bookings[0].start_time = 14;
  badHoursPayload.data.bookings[0].end_time = 12; // end_time < start_time
  const badHoursRes = validateFullBackupPayload(badHoursPayload);
  assert(badHoursRes.valid === false && badHoursRes.errors.some(e => e.includes('end_time') && e.includes('start_time')),
    '15. bookings com end_time <= start_time é rejeitado');

  const outOfRangeHoursPayload = createValidBackupPayload();
  outOfRangeHoursPayload.data.bookings[0].start_time = 5; // antes das 7h
  const outOfRangeRes = validateFullBackupPayload(outOfRangeHoursPayload);
  assert(outOfRangeRes.valid === false && outOfRangeRes.errors.some(e => e.includes('start_time')),
    '15b. bookings com start_time antes das 7h é rejeitado');

  // 16. Validação de Status Enum
  const badStatusPayload = createValidBackupPayload();
  badStatusPayload.data.bookings[0].status = 'invalido_status';
  const badStatusRes = validateFullBackupPayload(badStatusPayload);
  assert(badStatusRes.valid === false && badStatusRes.errors.some(e => e.includes('bookings[0].status')),
    '16. bookings.status com valor fora do enum é rejeitado');

  // 17. Blocked Slots com 'ALL' é aceito; com sala inexistente é rejeitado
  const badBlockedSlotRoom = createValidBackupPayload();
  badBlockedSlotRoom.data.blocked_slots[0].room_id = 'Sala Fantasma';
  const badBlockedSlotRes = validateFullBackupPayload(badBlockedSlotRoom);
  assert(badBlockedSlotRes.valid === false && badBlockedSlotRes.errors.some(e => e.includes('blocked_slots[0].room_id')),
    '17. blocked_slots.room_id inexistente é rejeitado');

  // 18. Sanitização de Credenciais Profunda
  const objWithSecret = {
    id: validAdminId,
    email: 'admin@locapsico.com.br',
    password: 'super_secret_password',
    token: 'jwt_token',
    profile: {
      api_key: 'key_123',
      name: 'Admin'
    }
  };
  const sanitized: any = sanitizeCredentialsDeep(objWithSecret);
  assert(
    !('password' in sanitized) &&
    !('token' in sanitized) &&
    !('api_key' in sanitized.profile) &&
    sanitized.profile.name === 'Admin',
    '18. sanitizeCredentialsDeep elimina recursivamente todas as credenciais sensíveis'
  );

  return { total, passed, failures };
}
