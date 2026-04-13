-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Resume` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `rawText` LONGTEXT NOT NULL,
    `structured` JSON NOT NULL,
    `targetRole` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Resume_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobDescription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `company` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `rawText` LONGTEXT NOT NULL,
    `parsed` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JobDescription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MatchRecord` (
    `id` VARCHAR(191) NOT NULL,
    `resumeId` VARCHAR(191) NOT NULL,
    `jobDescriptionId` VARCHAR(191) NOT NULL,
    `totalScore` INTEGER NOT NULL,
    `skillScore` INTEGER NOT NULL,
    `experienceScore` INTEGER NOT NULL,
    `educationScore` INTEGER NOT NULL,
    `expressionScore` INTEGER NOT NULL,
    `feedback` JSON NOT NULL,
    `aiModel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MatchRecord_resumeId_idx`(`resumeId`),
    INDEX `MatchRecord_jobDescriptionId_idx`(`jobDescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorrectionLog` (
    `id` VARCHAR(191) NOT NULL,
    `resumeId` VARCHAR(191) NOT NULL,
    `matchRecordId` VARCHAR(191) NULL,
    `dimension` VARCHAR(191) NOT NULL,
    `aiScore` INTEGER NOT NULL,
    `userScore` INTEGER NOT NULL,
    `userNote` TEXT NOT NULL,
    `skillTags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CorrectionLog_resumeId_idx`(`resumeId`),
    INDEX `CorrectionLog_dimension_idx`(`dimension`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Resume` ADD CONSTRAINT `Resume_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobDescription` ADD CONSTRAINT `JobDescription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MatchRecord` ADD CONSTRAINT `MatchRecord_resumeId_fkey` FOREIGN KEY (`resumeId`) REFERENCES `Resume`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MatchRecord` ADD CONSTRAINT `MatchRecord_jobDescriptionId_fkey` FOREIGN KEY (`jobDescriptionId`) REFERENCES `JobDescription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorrectionLog` ADD CONSTRAINT `CorrectionLog_resumeId_fkey` FOREIGN KEY (`resumeId`) REFERENCES `Resume`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorrectionLog` ADD CONSTRAINT `CorrectionLog_matchRecordId_fkey` FOREIGN KEY (`matchRecordId`) REFERENCES `MatchRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
