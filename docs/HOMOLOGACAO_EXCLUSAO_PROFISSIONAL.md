# Homologação — exclusão de profissional

Esta mudança permanece isolada na branch `fix/professional-removal-preserve-history`. Não faça merge nem deploy de produção antes de concluir todos os passos abaixo.

## 1. Separar os ambientes do Cloudflare Pages

Em **Workers & Pages → projeto LocaPsico → Settings → Variables and Secrets**, configure os valores separadamente para Production e Preview.

| Variável | Production | Preview |
|---|---|---|
| `LOCAPSICO_ENV` | `production` | `staging` |
| `SUPABASE_URL` | `https://gqpavuqopukyfeyqyrxc.supabase.co` | `https://rhuwvnusbzdgoaarhbkr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secreta do projeto de produção | chave secreta do projeto de homologação |

A chave `SUPABASE_SERVICE_ROLE_KEY` deve ser cadastrada como **Secret**, nunca como variável pública, nunca com prefixo `VITE_` e nunca no GitHub. Não reutilize a chave de produção no Preview.

O endpoint de exclusão falha de forma fechada se `LOCAPSICO_ENV` estiver ausente ou se a URL apontar para o projeto incompatível com o ambiente.

## 2. Aplicar a migration somente em homologação

No painel Supabase, confirme visualmente o projeto `rhuwvnusbzdgoaarhbkr`. Abra **SQL Editor** e execute o conteúdo do arquivo:

`supabase/migrations/20261109000000_admin_remove_professional_preserve_history.sql`

Não execute esse arquivo no projeto de produção nesta etapa.

## 3. Executar o teste SQL reversível

Ainda no projeto de homologação, execute o arquivo:

`scripts/staging_professional_removal_test.sql`

O script abre uma transação, cria duas reservas e dois pagamentos de teste, executa a RPC, verifica as permissões e os dados preservados e termina com `ROLLBACK`. Se todas as verificações passarem, o SQL Editor exibirá a mensagem `PASSOU`. Nenhum registro de teste deve permanecer.

Execute em horário sem uso da homologação, pois os registros de teste ficam visíveis dentro da transação enquanto ela estiver aberta.

## 4. Testar o endpoint e o Supabase Auth

Com uma implantação **Preview** da branch apontando exclusivamente para homologação, crie ou escolha um profissional descartável de teste, com uma reserva passada, uma futura e pagamentos de teste. Use a tela administrativa para excluí-lo.

Confirme no projeto de homologação:
- o profissional desapareceu da lista operacional;
- `profiles.status` ficou `INACTIVE`;
- a linha correspondente em `professionals` foi removida;
- reservas passadas e de hoje continuam no histórico;
- reservas com data posterior a hoje foram removidas;
- pagamentos continuam existindo; se ligados a reserva futura removida, `booking_id` fica nulo;
- o usuário Auth foi soft-deleted (`deleted_at` preenchido), e não consegue iniciar nova sessão;
- uma sessão antiga não consegue consultar ou alterar as tabelas protegidas.

O soft delete do Auth mantém o vínculo técnico necessário para preservar as chaves estrangeiras do histórico. O perfil inativo permanece no banco, mas deixa de aparecer no cadastro operacional.

## 5. Critério para liberar produção

Só considerar a mudança pronta depois de:
1. migration aplicada sem erro em homologação;
2. teste SQL reversível com resultado `PASSOU`;
3. teste real do endpoint/soft delete Auth concluído em Preview;
4. confirmação dos dados acima;
5. CI verde para o commit final da branch.

Até lá, mantenha a branch separada. Não faça merge, não execute migration em produção e não publique a alteração.
