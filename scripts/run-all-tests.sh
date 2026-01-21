#!/bin/bash

FIGURES=(adler aesop allen aristotle bacon bergler bergson berkeley confucius darwin descartes dewey dworkin engels freud galileo gardner goldman hegel hume james kant kernberg kuczynski laplace la_rochefoucauld le_bon leibniz maimonides mill nietzsche peirce plato poincare rousseau russell sartre smith tocqueville veblen weyl whewell)

OUTPUT_DIR="scripts/paper-writer-tests/outputs"
LOG_FILE="scripts/paper-writer-tests/batch-log.txt"

mkdir -p "$OUTPUT_DIR"
echo "Starting batch test at $(date)" > "$LOG_FILE"

total=${#FIGURES[@]}
passed=0
failed=0

for i in "${!FIGURES[@]}"; do
    figure="${FIGURES[$i]}"
    num=$((i + 1))
    
    # Skip if already exists
    if [ -f "$OUTPUT_DIR/${figure}-summary.txt" ]; then
        words=$(wc -w < "$OUTPUT_DIR/${figure}-summary.txt")
        echo "[$num/$total] $figure - SKIPPED (already exists: $words words)"
        echo "[$num/$total] $figure - SKIPPED ($words words)" >> "$LOG_FILE"
        ((passed++))
        continue
    fi
    
    echo "[$num/$total] Testing $figure..."
    
    if npx tsx scripts/test-single.ts "$figure" >> "$LOG_FILE" 2>&1; then
        words=$(wc -w < "$OUTPUT_DIR/${figure}-summary.txt" 2>/dev/null || echo "0")
        echo "  => SUCCESS: $words words"
        ((passed++))
    else
        echo "  => FAILED"
        ((failed++))
    fi
    
    sleep 3
done

echo ""
echo "=========================================="
echo "BATCH TEST COMPLETE"
echo "Passed: $passed / $total"
echo "Failed: $failed / $total"
echo "=========================================="
echo "Completed at $(date)" >> "$LOG_FILE"
echo "Passed: $passed, Failed: $failed" >> "$LOG_FILE"
