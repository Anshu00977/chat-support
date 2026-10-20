CREATE TABLE `CannedReply` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shortcut` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CannedReply_shortcut_key`(`shortcut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;
