-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bannerImage" TEXT;

-- AlterTable
ALTER TABLE "CompanyPost" ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Company Update';
