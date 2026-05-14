import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const documents = await prisma.document.findMany({
      select: { name: true, status: true, kbId: true }
    });
    console.log('Documents:', JSON.stringify(documents, null, 2));
    
    const chunkCount = await prisma.documentChunk.count();
    console.log('Total Chunks:', chunkCount);

    const kbs = await prisma.knowledgeBase.findMany({
        select: { id: true, name: true }
    });
    console.log('KBs:', JSON.stringify(kbs, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
