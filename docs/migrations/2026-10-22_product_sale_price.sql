-- Run ONLY against a selected backed-up tenant database after verifying the target.
-- Not rerunnable: prefer scripts/apply-customer-upgrade.js for absent/partial/already-upgraded schemas.
-- price remains the listed price; sale_price is the selling price.
ALTER TABLE products ADD COLUMN sale_price DECIMAL(15,2) NULL AFTER price;
UPDATE products SET sale_price = price WHERE sale_price IS NULL;
ALTER TABLE products MODIFY COLUMN sale_price DECIMAL(15,2) NOT NULL;