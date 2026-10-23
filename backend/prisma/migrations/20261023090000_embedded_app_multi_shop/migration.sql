-- EmbeddedApp is now keyed by its secret, not by a single shop, so one
-- connected app (e.g. ConvoBridge) can serve every shop that installs it,
-- the same way WishKeeper's dedicated integration already does.

ALTER TABLE `EmbeddedApp` DROP INDEX `EmbeddedApp_shop_key`;
ALTER TABLE `EmbeddedApp` DROP COLUMN `shop`;
-- internalSecret was TEXT (unindexable); narrow it to a VARCHAR so a unique index can exist on it.
ALTER TABLE `EmbeddedApp` MODIFY COLUMN `internalSecret` VARCHAR(191) NOT NULL;
ALTER TABLE `EmbeddedApp` ADD UNIQUE INDEX `EmbeddedApp_internalSecret_key` (`internalSecret`);

ALTER TABLE `Message` ADD COLUMN `embeddedAppId` INT NULL;
ALTER TABLE `Message` ADD CONSTRAINT `Message_embeddedAppId_fkey`
  FOREIGN KEY (`embeddedAppId`) REFERENCES `EmbeddedApp`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
