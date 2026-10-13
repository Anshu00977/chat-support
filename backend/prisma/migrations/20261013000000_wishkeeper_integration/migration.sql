-- AlterTable
ALTER TABLE `Message` ADD COLUMN `externalThreadId` VARCHAR(191) NULL,
    ADD COLUMN `source` ENUM('WIDGET', 'WISHKEEPER') NOT NULL DEFAULT 'WIDGET',
    MODIFY `appId` INTEGER NULL;

-- AlterTable
ALTER TABLE `MessageReply` ADD COLUMN `externalId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Message_externalThreadId_key` ON `Message`(`externalThreadId`);

-- CreateIndex
CREATE UNIQUE INDEX `MessageReply_externalId_key` ON `MessageReply`(`externalId`);

