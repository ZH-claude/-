import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD_HASH_ROUNDS = 12;
const TEST_PASSWORD = process.env.MERCHANT_TEST_PASSWORD;
const TEST_USERNAMES = ['merchant_test_1', 'merchant_test_2', 'merchant_test_3'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to seed merchant test accounts');
}

if (!TEST_PASSWORD) {
  throw new Error('MERCHANT_TEST_PASSWORD is required to seed merchant test accounts');
}

if (TEST_PASSWORD.length < 8 || TEST_PASSWORD.length > 128) {
  throw new Error('MERCHANT_TEST_PASSWORD must be 8-128 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, PASSWORD_HASH_ROUNDS);

  const group = await prisma.userGroup.upsert({
    where: { code: 'default' },
    update: {},
    create: {
      code: 'default',
      name: 'Default Group'
    }
  });

  const accounts = [];
  for (const username of TEST_USERNAMES) {
    const account = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { username }
      });

      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              passwordHash,
              role: UserRole.ADMIN,
              status: UserStatus.ACTIVE,
              groupId: group.id,
              deletedAt: null
            }
          })
        : await tx.user.create({
            data: {
              username,
              passwordHash,
              role: UserRole.ADMIN,
              status: UserStatus.ACTIVE,
              groupId: group.id,
              inviteCode: createInviteCode()
            }
          });

      await tx.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id }
      });

      return user;
    });

    accounts.push({
      id: account.id,
      username: account.username,
      role: account.role.toLowerCase(),
      status: account.status.toLowerCase()
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        accounts,
        passwordConfigured: true
      },
      null,
      2
    )
  );
}

function createInviteCode() {
  return `merchant-${randomBytes(4).toString('hex')}`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
