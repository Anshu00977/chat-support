-- Supports connecting an app with no database of its own for chat -- its
-- conversation lives entirely in Supportly's own Message/MessageReply rows,
-- polled directly by the app's widget via /embedded/thread/*.

ALTER TABLE `EmbeddedApp` MODIFY COLUMN `databaseUrl` TEXT NULL;

ALTER TABLE `Message` ADD COLUMN `adminTypingAt` DATETIME(3) NULL;
ALTER TABLE `Message` ADD COLUMN `embeddedResetAt` DATETIME(3) NULL;
