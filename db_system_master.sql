-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: db_system_master
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `payment_logs`
--

DROP TABLE IF EXISTS `payment_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã giao dịch của ngân hàng (VD: VNP123456)',
  `amount_paid` decimal(15,2) DEFAULT NULL COMMENT 'Số tiền THỰC TẾ khách đã chuyển',
  `bank_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã ngân hàng (VD: VCB, MBBANK)',
  `payment_time` datetime DEFAULT NULL COMMENT 'Thời gian giao dịch do ngân hàng ghi nhận',
  `status` enum('SUCCESS','FAILED','IGNORED','ERROR') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `raw_payload` json DEFAULT NULL COMMENT 'Toàn bộ dữ liệu Webhook gửi sang',
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Lý do lỗi (VD: Sai chữ ký, Số tiền không khớp, Không tìm thấy đơn)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_code` (`order_code`),
  KEY `idx_transaction_id` (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_logs`
--

LOCK TABLES `payment_logs` WRITE;
/*!40000 ALTER TABLE `payment_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pending_orders`
--

DROP TABLE IF EXISTS `pending_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pending_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount_due` decimal(15,2) NOT NULL,
  `customer_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `spa_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `manager_username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `manager_password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `package_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'LIFETIME',
  `status` enum('PENDING','PROCESSING','SUCCESS','FAILED','EXPIRED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `payment_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transaction_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_code` (`order_code`),
  KEY `idx_order_code` (`order_code`),
  KEY `idx_status_created_at` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pending_orders`
--

LOCK TABLES `pending_orders` WRITE;
/*!40000 ALTER TABLE `pending_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `pending_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subscription_packages`
--

DROP TABLE IF EXISTS `subscription_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `package_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(15,2) NOT NULL,
  `duration_months` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `package_code` (`package_code`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscription_packages`
--

LOCK TABLES `subscription_packages` WRITE;
/*!40000 ALTER TABLE `subscription_packages` DISABLE KEYS */;
INSERT INTO `subscription_packages` VALUES (1,'1_MONTH','Dùng thử 1 tháng',500000.00,1,'2026-09-27 17:02:41','2026-09-27 17:02:41',NULL),(2,'1_YEAR','Trọn gói 1 năm',5000000.00,12,'2026-09-27 17:02:41','2026-09-27 17:02:41',NULL),(3,'LIFETIME','Gói Vĩnh Viễn (Mua 1 lần)',40000000.00,NULL,'2026-09-27 17:02:41','2026-09-27 17:02:41',NULL);
/*!40000 ALTER TABLE `subscription_packages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tenants`
--

DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `spa_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `database_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `expire_at` datetime DEFAULT NULL COMMENT 'Ngày hết hạn gói phần mềm',
  `deleted_at` datetime DEFAULT NULL,
  `created_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenants`
--

LOCK TABLES `tenants` WRITE;
/*!40000 ALTER TABLE `tenants` DISABLE KEYS */;
INSERT INTO `tenants` VALUES (1,'Thẩm Mỹ Viện Ngọc Lan (VIP)','db_spa_1790527015802_5bac','2026-09-27 16:36:55','2026-10-10 14:26:41',NULL,'2026-10-10 21:26:41',NULL,'superadmin','superadmin'),(2,'Thẩm Mỹ Viện Quốc Tế Ngọc Lan Là Lá La','db_spa_1790606527302_ad31','2026-09-28 14:42:07','2026-09-28 14:42:07',NULL,NULL,NULL,NULL,NULL),(3,'Thẩm Mỹ Viện Quốc Tế Ngọc Lan','db_spa_1790610012158_289b','2026-09-28 15:40:12','2026-09-28 15:40:12',NULL,NULL,'hackerr',NULL,NULL),(4,'shop quần áo dũng hoàng','db_spa_1790667981456_b7e6','2026-09-29 07:46:21','2026-09-29 07:46:21','2027-09-29 14:46:21',NULL,'superadmin',NULL,NULL),(5,'shop bóng bàn','db_spa_1790672389874_3034','2026-09-29 08:59:49','2026-09-29 08:59:49','2027-09-29 15:59:50',NULL,'superadmin',NULL,NULL),(6,'minhngoc','db_spa_1791013152799_05d8','2026-10-03 07:39:12','2026-10-10 14:33:58',NULL,NULL,'superadmin','superadmin',NULL),(7,'hehe','db_spa_1791039769068_e185','2026-10-03 15:02:49','2026-10-10 14:25:05','2028-10-03 22:02:49',NULL,'superadmin','superadmin',NULL),(8,'Xuly','db_spa_1791642286670_c571','2026-10-10 14:24:46','2026-10-10 14:24:46',NULL,NULL,'superadmin',NULL,NULL);
/*!40000 ALTER TABLE `tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int DEFAULT NULL,
  `branch_id` int DEFAULT NULL,
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fullname` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `system_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  `created_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_by` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `idx_unique_username` (`username`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,NULL,NULL,'superadmin',NULL,'$2b$10$N64vGmtVCtJls.H6WOmojuSLk7EY/WAcZb/slBC/ZvA14DHXHkj.S','SUPER_ADMIN','2026-09-27 07:46:17','2026-09-27 15:25:02',NULL,NULL,NULL,NULL),(2,1,NULL,'xulyhihi',NULL,'$2b$10$TppwBPLuMIxXKlD3.9X8COz7aBhAhYqVXXSCjBw4vmLYUYOaJQw5G','MANAGER','2026-09-27 16:36:55','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,NULL,'superadmin'),(3,1,NULL,'letan',NULL,'$2b$10$.9YbHXLYGijGlgiFYaPH5uKs9TTi8fDB06wMbn/3DCyo1STFDXsfe','STAFF','2026-09-28 13:29:00','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,NULL,'superadmin'),(4,1,NULL,'quanly',NULL,'$2b$10$UIsR32XzrJjz3z49F7YQZu.jBLZbOLGY8d2upi8oGT18U3m8b/ESS','MANAGER','2026-09-28 14:18:01','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,NULL,'superadmin'),(5,1,NULL,'hacker',NULL,'$2b$10$VzrVJChhhHsJQTUJQGbTXuPmbVpHghyBN7OBYQIu2bJWis1CdYOKa','SUPERADMIN','2026-09-28 14:34:49','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,NULL,'superadmin'),(6,1,NULL,'hackerr',NULL,'$2b$10$0JB8sqwiiApfbyOOgmSriuj5Ty8rpRg0UDBCWEpzYH1B17b2gstnG','SUPER_ADMIN','2026-09-28 14:36:18','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,NULL,'superadmin'),(7,2,NULL,'xulyhihihaha',NULL,'$2b$10$po7td6u4RKP2CRM0HclIq..n15LRs.ro4VZW3Bix/67xiyHDTg4i6','MANAGER','2026-09-28 14:42:07','2026-09-28 14:42:07',NULL,NULL,NULL,NULL),(8,3,NULL,'xulyhihihi','Xuân Hoàng','$2b$10$G5zq.LRq3i4BQ.FhQIdYI.81UiAoyjrZjtxiwFQKRtXdHh8WoLglG','MANAGER','2026-09-28 15:40:12','2026-09-28 15:40:12',NULL,'hackerr',NULL,NULL),(9,1,NULL,'NON','Nguyễn Thị Ngọc Lan (Đã đổi tên)','$2b$10$/yYsGig4A9bw0.o8ZOyxku2bA0MS7CdXZQ0k42bGrEi4Qqmo9rI2i','STAFF','2026-09-28 15:41:29','2026-10-10 14:26:41','2026-10-10 21:26:41',NULL,'xulyhihi','superadmin'),(10,NULL,NULL,'NONlam','Lý','$2b$10$T5kLcSQY7FlLXdnBUUxzn.XbPqUSsGOUNh6vWcOrFUzMymyRebine','STAFF','2026-09-28 15:51:22','2026-09-28 15:51:22',NULL,'xulyhihi',NULL,NULL),(11,4,NULL,'dunghoang','Dũng','$2b$10$NKys9V/GEJNOU75xcLGUjeliRh1pI.pwaUOrBqxp/XpqIQmljuKxW','MANAGER','2026-09-29 07:46:21','2026-09-29 07:46:21',NULL,'superadmin',NULL,NULL),(12,4,NULL,'dunghoang1','Lý Hoàng','$2b$10$HK2.DWCLAAsbXjW6x9WQjOOT6L3EE18HQU9SLvCoKd2ksXc5SKdVi','STAFF','2026-09-29 07:50:40','2026-09-29 07:51:56',NULL,'Dũng','Dũng',NULL),(13,5,NULL,'0204hoangdung','hi','$2b$10$WiiU5Tm4c3d9GZKRR.K.Y.2Eq0o/i2bYW941juOgIfN.veonjNBRi','MANAGER','2026-09-29 08:59:49','2026-09-29 08:59:49',NULL,'superadmin',NULL,NULL),(14,5,NULL,'letan_mai','Nguyễn Thị Mai','$2b$10$O0YOY.06TEc4hAs3Ar03t.fYucdKN76fjEyTvr9PGMtbkaeWZbmVq','STAFF','2026-09-29 09:08:09','2026-09-29 09:08:09',NULL,'hi',NULL,NULL),(15,5,NULL,'letan_dung','Nguyễn Thị Mai','$2b$10$VkbLlzRs6LNZj9melVnLUuSfl06Y9YnC6csAL2eJCO7ZHhrbiYJ7.','STAFF','2026-09-29 09:17:44','2026-09-29 09:17:44',NULL,'hi',NULL,NULL),(16,5,NULL,'letan_dunghoang','Nguyễn Thị Mai','$2b$10$tA4PnRBkWa15WqKkYm4deOtgvPi8jYO.xeopfoZF9.XygcOznc7M.','STAFF','2026-09-29 09:19:14','2026-09-29 09:19:14',NULL,'hi',NULL,NULL),(17,5,NULL,'letan_dg','Nguyễn Thị Mai','$2b$10$o4EcDAqFvVn8TcDryldRv.TMwQnxdpOzsNNjVF88LIi/AbzPI84he','STAFF','2026-09-29 09:20:38','2026-09-29 09:20:38',NULL,'hi',NULL,NULL),(18,5,NULL,'letang','Nguyễn Thị Mai','$2b$10$xzzDMsSzRRea4ZfAsZ21mON1tylRkobEl6exlg7yMRuCfErGW9my2','STAFF','2026-09-29 09:22:00','2026-09-29 09:22:00',NULL,'hi',NULL,NULL),(19,5,1,'letanhihi','Nguyễn Thị Mai','$2b$10$O4kKwpW4Pp1qBy1xeH6mC.bTq7RJ8eNq0xs.0O/W6E5r5CKYIlaEK','STAFF','2026-09-29 09:25:40','2026-09-29 09:25:40',NULL,'hi',NULL,NULL),(20,5,2,'coso2','Nguyễn Thị Mai','$2b$10$j/LLmb/rEEAw5U77nzI7suVqNMDBxgDNzVUw1Ns0yv1OP9hxQ6wIi','STAFF','2026-09-29 09:26:03','2026-09-29 09:26:03',NULL,'hi',NULL,NULL),(21,6,NULL,'minhngoc','Minh Ngọc','$2b$10$8Uawtzca0cgfQmCnCXe1r.FZI/aitvq3.CNRz9leHD9svTEOxLo5.','MANAGER','2026-10-03 07:39:12','2026-10-03 07:39:12',NULL,'superadmin',NULL,NULL),(22,7,NULL,'3thang10','chị Hiển','$2b$10$P.Gcbh9vtjCSDboFqdcBteRkzQnkkV4VFd/YWnhi0tpewCKIJDPmK','MANAGER','2026-10-03 15:02:49','2026-10-24 01:37:57',NULL,'superadmin','Thúy Ngân',NULL),(23,7,1,'nvcs1','Lê Thị Xuân','$2b$10$CJ4RtATPhIRgnFfG6B.FmOmD8LiJqYAlvRZp.NrVk1bmmhwhoEgqK','STAFF','2026-10-04 02:40:15','2026-10-10 14:41:00',NULL,'Minh Ngọc','Minh Ngọc',NULL),(24,7,2,'nvcs2','Kim Sô Đa','$2b$10$SbFOGEcxKmI9gIN96PBd5umqKu09igtBnUM3JkaC5vythCv2krxhy','STAFF','2026-10-09 08:57:02','2026-10-09 08:57:02',NULL,'Minh Ngọc',NULL,NULL),(25,8,NULL,'lyhoang','BS Lý','$2b$10$/Z9ggGx79i6EqYssxw75zerSMNivU98/.ARwSeVA1wBnN51l35/FS','MANAGER','2026-10-10 14:24:46','2026-10-10 14:24:46',NULL,'superadmin',NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-03 10:25:53
