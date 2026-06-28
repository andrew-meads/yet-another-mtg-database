docker run --rm \
  -v yet-another-mtg-database_yamtgd-mongo-data:/volume \
  -v $(pwd)/backup:/backup \
  alpine \
  tar czf /backup/yamtgd-mongo-data-backup.tar.gz -C /volume .

docker run --rm \
  -v yet-another-mtg-database_card-scanner-pgdata:/volume \
  -v $(pwd)/backup:/backup \
  alpine \
  tar czf /backup/card-scanner-pgdata-backup.tar.gz -C /volume .