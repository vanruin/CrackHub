import os
import re
from pathlib import Path

def extract_netflix_id_from_file(file_path):
    """Extract NetflixId value from a text file containing cookie data."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
            
        # Split into lines and look for NetflixId line
        lines = content.split('\n')
        
        for line in lines:
            # Look for line containing .netflix.com and NetflixId
            if '.netflix.com' in line and 'NetflixId' in line:
                # Split by tabs
                parts = line.split('\t')
                if len(parts) >= 7:
                    # The cookie value is at index 6 (0-based)
                    cookie_value = parts[6].strip()
                    return f"NetflixId={cookie_value}"
        
        return None
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None

def main():
    # Ask user for folder path
    folder_path = input("Enter the folder path containing the text files: ").strip()
    
    # Convert to Path object
    folder = Path(folder_path)
    
    # Check if folder exists
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return
    
    if not folder.is_dir():
        print(f"Error: '{folder_path}' is not a directory.")
        return
    
    # Find all .txt files in the folder
    txt_files = list(folder.glob("*.txt"))
    
    if not txt_files:
        print(f"No .txt files found in '{folder_path}'")
        return
    
    print(f"Found {len(txt_files)} text file(s)")
    
    # Extract NetflixId from each file
    netflix_ids = []
    for txt_file in txt_files:
        print(f"Processing: {txt_file.name}")
        netflix_id = extract_netflix_id_from_file(txt_file)
        if netflix_id:
            netflix_ids.append(netflix_id)
            print(f"  ✓ Found NetflixId")
        else:
            print(f"  ✗ No NetflixId found")
    
    if not netflix_ids:
        print("No NetflixId values found in any files.")
        return
    
    # Write all NetflixIds to a single output file
    output_file = folder / "extracted_netflix_ids.txt"
    
    try:
        with open(output_file, 'w', encoding='utf-8') as out_file:
            for netflix_id in netflix_ids:
                out_file.write(netflix_id + '\n')
        
        print(f"\n✅ Successfully extracted {len(netflix_ids)} NetflixId(s)")
        print(f"📄 Output saved to: {output_file}")
        
        # Display the extracted values
        print("\nExtracted values:")
        for netflix_id in netflix_ids:
            print(f"  {netflix_id[:100]}..." if len(netflix_id) > 100 else f"  {netflix_id}")
            
    except Exception as e:
        print(f"Error writing output file: {e}")

if __name__ == "__main__":
    main()