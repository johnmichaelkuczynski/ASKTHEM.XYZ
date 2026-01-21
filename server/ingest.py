import os
import psycopg2
from datetime import datetime
import re

# INGESTION FOLDER: Drop files here with naming convention:
# - Works:     author_works_n.txt     (e.g., kuczynski_works_1.txt)
# - Positions: author_positions_n.txt (e.g., kuczynski_positions_98.txt)
# - Quotes:    author_quotes_n.txt    (e.g., freud_quotes_8.txt)
INGEST_FOLDER = "data/ingest"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100

def get_db_connection():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise Exception("DATABASE_URL not found in environment variables")
    return psycopg2.connect(database_url)

def parse_filename(filename):
    name = filename.rsplit('.', 1)[0]
    if '_' not in name:
        raise ValueError(f"Invalid filename format: {filename}. Expected AUTHOR_Title.txt")
    parts = name.split('_', 1)
    thinker = parts[0].lower()
    return thinker

def get_file_type(filename):
    lower = filename.lower()
    if '_positions_' in lower:
        return 'positions'
    elif '_quotes_' in lower:
        return 'quotes'
    elif '_works_' in lower:
        return 'works'
    elif '_arguments_' in lower:
        return 'arguments'
    else:
        return 'chunks'

def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk.strip())
        start = end - overlap
    return [c for c in chunks if c]

def extract_pipe_delimited(text):
    """Extract pipe-delimited entries: thinker | content | topic"""
    lines = text.split('\n')
    entries = []

    for line in lines:
        line = line.strip()
        if not line or ' | ' not in line:
            continue

        parts = line.split(' | ')
        if len(parts) >= 2:
            thinker = parts[0].strip()
            content = parts[1].strip()
            topic = parts[2].strip() if len(parts) >= 3 else None
            entries.append({
                'thinker': thinker,
                'content': content,
                'topic': topic
            })

    return entries

def ingest_positions_file(filepath, conn):
    filename = os.path.basename(filepath)
    print(f"Processing POSITIONS: {filename}")
    thinker_from_filename = parse_filename(filename)
    print(f"  Thinker (from filename): {thinker_from_filename}")

    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    entries = extract_pipe_delimited(text)
    print(f"  Positions found: {len(entries)}")

    cursor = conn.cursor()
    for e in entries:
        thinker = e.get('thinker') or thinker_from_filename
        cursor.execute("""
            INSERT INTO positions (thinker, position_text, topic, created_at)
            VALUES (%s, %s, %s, %s)
        """, (thinker, e['content'], e['topic'], datetime.now()))

    conn.commit()
    cursor.close()
    print(f"  Inserted {len(entries)} positions into database.")

    os.remove(filepath)
    print(f"  Deleted: {filename}")

def ingest_quotes_file(filepath, conn):
    filename = os.path.basename(filepath)
    print(f"Processing QUOTES: {filename}")
    thinker_from_filename = parse_filename(filename)
    print(f"  Thinker (from filename): {thinker_from_filename}")

    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    entries = extract_pipe_delimited(text)
    print(f"  Quotes found: {len(entries)}")

    cursor = conn.cursor()
    for e in entries:
        thinker = e.get('thinker') or thinker_from_filename
        cursor.execute("""
            INSERT INTO quotes (thinker, quote_text, topic, created_at)
            VALUES (%s, %s, %s, %s)
        """, (thinker, e['content'], e['topic'], datetime.now()))

    conn.commit()
    cursor.close()
    print(f"  Inserted {len(entries)} quotes into database.")

    os.remove(filepath)
    print(f"  Deleted: {filename}")

def extract_arguments(text):
    """Extract argument entries from markdown format:
    ### Argument N (type)
    **Author:** name
    **Premises:**
    - premise 1
    - premise 2
    **→ Conclusion:** conclusion text
    *Source: topic | Importance: N/10*
    """
    import json
    import re
    entries = []
    
    # Split by argument headers
    argument_blocks = re.split(r'###\s*Argument\s+\d+\s*\(([^)]+)\)', text)
    
    # First element is preamble, then alternating: type, content, type, content...
    i = 1
    while i < len(argument_blocks) - 1:
        argument_type = argument_blocks[i].strip().lower()
        block = argument_blocks[i + 1]
        i += 2
        
        # Extract author
        author_match = re.search(r'\*\*Author:\*\*\s*(\w+)', block)
        thinker = author_match.group(1).lower() if author_match else None
        
        # Extract premises (lines starting with -)
        premises_section = re.search(r'\*\*Premises:\*\*(.*?)(?:\*\*→|$)', block, re.DOTALL)
        premises = []
        if premises_section:
            premise_lines = re.findall(r'^-\s*(.+)$', premises_section.group(1), re.MULTILINE)
            premises = [p.strip() for p in premise_lines if p.strip()]
        
        # Extract conclusion
        conclusion_match = re.search(r'\*\*→\s*Conclusion:\*\*\s*(.+?)(?:\n\n|\*Source|$)', block, re.DOTALL)
        conclusion = conclusion_match.group(1).strip() if conclusion_match else ''
        
        # Extract source/topic and importance
        source_match = re.search(r'\*Source:\s*([^|]+)', block)
        topic = source_match.group(1).strip() if source_match else None
        
        importance_match = re.search(r'Importance:\s*(\d+)/10', block)
        importance = int(importance_match.group(1)) if importance_match else 5
        
        if premises and conclusion:
            entries.append({
                'thinker': thinker,
                'argument_type': argument_type,
                'premises': json.dumps(premises),
                'conclusion': conclusion,
                'topic': topic,
                'importance': importance
            })
    
    return entries

def ingest_arguments_file(filepath, conn):
    filename = os.path.basename(filepath)
    print(f"Processing ARGUMENTS: {filename}")
    thinker_from_filename = parse_filename(filename)
    print(f"  Thinker (from filename): {thinker_from_filename}")

    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    entries = extract_arguments(text)
    print(f"  Arguments found: {len(entries)}")

    cursor = conn.cursor()
    for e in entries:
        thinker = e.get('thinker') or thinker_from_filename
        cursor.execute("""
            INSERT INTO arguments (thinker, argument_type, premises, conclusion, topic, importance, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (thinker, e['argument_type'], e['premises'], e['conclusion'], e['topic'], e['importance'], datetime.now()))

    conn.commit()
    cursor.close()
    print(f"  Inserted {len(entries)} arguments into database.")

    os.remove(filepath)
    print(f"  Deleted: {filename}")

def ingest_chunks_file(filepath, conn):
    filename = os.path.basename(filepath)
    print(f"Processing CHUNKS: {filename}")
    thinker = parse_filename(filename)
    name = filename.rsplit('.', 1)[0]
    parts = name.split('_', 1)
    source_file = parts[1] if len(parts) > 1 else name
    print(f"  Thinker: {thinker}")
    print(f"  Source: {source_file}")

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

    chunks = chunk_text(text)
    print(f"  Chunks: {len(chunks)}")

    cursor = conn.cursor()
    for index, chunk_text_content in enumerate(chunks):
        cursor.execute("""
            INSERT INTO text_chunks (thinker, source_file, chunk_text, chunk_index, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (thinker, source_file, chunk_text_content, index, datetime.now()))

    conn.commit()
    cursor.close()
    print(f"  Inserted {len(chunks)} chunks into database.")

    os.remove(filepath)
    print(f"  Deleted: {filename}")

def ingest_works_file(filepath, conn):
    """Ingest full works/texts into the texts table"""
    filename = os.path.basename(filepath)
    print(f"Processing WORKS: {filename}")
    thinker = parse_filename(filename)
    
    # Extract title from filename: author_works_n.txt -> clean title
    name = filename.rsplit('.', 1)[0]
    parts = name.split('_')
    # Remove author and 'works' and number, keep rest as title
    title_parts = [p for p in parts[2:] if not p.isdigit()]
    title = ' '.join(title_parts) if title_parts else name
    
    print(f"  Thinker: {thinker}")
    print(f"  Title: {title}")

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    print(f"  Content length: {len(content)} characters")

    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO texts (thinker, title, source_file, content, created_at)
        VALUES (%s, %s, %s, %s, %s)
    """, (thinker, title, filename, content, datetime.now()))

    conn.commit()
    cursor.close()
    print(f"  Inserted work '{title}' into texts table.")

    os.remove(filepath)
    print(f"  Deleted: {filename}")

def ingest_file(filepath, conn):
    filename = os.path.basename(filepath)
    file_type = get_file_type(filename)

    if file_type == 'positions':
        ingest_positions_file(filepath, conn)
    elif file_type == 'quotes':
        ingest_quotes_file(filepath, conn)
    elif file_type == 'works':
        ingest_works_file(filepath, conn)
    elif file_type == 'arguments':
        ingest_arguments_file(filepath, conn)
    else:
        ingest_chunks_file(filepath, conn)

def main():
    if not os.path.exists(INGEST_FOLDER):
        print(f"Creating ingest folder: {INGEST_FOLDER}")
        os.makedirs(INGEST_FOLDER)
        print("Drop files here and run this script again.")
        return

    files = [f for f in os.listdir(INGEST_FOLDER) if '_' in f]
    if not files:
        print(f"No files found in {INGEST_FOLDER}")
        return

    print(f"Found {len(files)} file(s) to process.\n")
    conn = get_db_connection()

    for filename in files:
        filepath = os.path.join(INGEST_FOLDER, filename)
        try:
            ingest_file(filepath, conn)
            print()
        except Exception as e:
            print(f"  ERROR: {e}")
            conn.rollback()  # Reset transaction state so next file can proceed
            print()

    conn.close()

    print("Done.")

if __name__ == "__main__":
    main()