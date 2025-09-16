import { describe, it, expect } from 'vitest';
import { parseArgsToArray, arrayToArgsJson } from '../../../../src/pages/Setting/components/utils';

describe('parseArgsToArray', () => {
  it('should parse JSON array string to array', () => {
    const input = '["arg1", "arg2", "arg3"]';
    const expected = ['arg1', 'arg2', 'arg3'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse JSON array string with special characters', () => {
    const input = '["-y", "@modelcontextprotocol/server-sequential-thinking"]';
    const expected = ['-y', '@modelcontextprotocol/server-sequential-thinking'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse JSON array string with file paths containing backslashes', () => {
    const input = '["--directory", "C:\\\\Users\\\\ASUS\\\\Desktop\\\\project", "run", "main.py"]';
    const expected = ['--directory', 'C:\\Users\\ASUS\\Desktop\\project', 'run', 'main.py'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse JSON array string with file paths containing forward slashes', () => {
    const input = '["--directory", "C:/Users/ASUS/Desktop/project", "run", "main.py"]';
    const expected = ['--directory', 'C:/Users/ASUS/Desktop/project', 'run', 'main.py'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse comma-separated string to array', () => {
    const input = '-y,@modelcontextprotocol/server-filesystem,.';
    const expected = ['-y', '@modelcontextprotocol/server-filesystem', '.'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse comma-separated string with spaces', () => {
    const input = '-y, @modelcontextprotocol/server-filesystem, .';
    const expected = ['-y', '@modelcontextprotocol/server-filesystem', '.'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should parse comma-separated string with file paths containing slashes', () => {
    const input = '--directory,C:/Users/ASUS/Desktop/project,run,main.py';
    const expected = ['--directory', 'C:/Users/ASUS/Desktop/project', 'run', 'main.py'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should handle empty string', () => {
    const input = '';
    const expected: string[] = [];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should handle whitespace-only string', () => {
    const input = '   ';
    const expected: string[] = [];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should filter out empty args from comma-separated string', () => {
    const input = '-y,,@modelcontextprotocol/server-filesystem,.';
    const expected = ['-y', '@modelcontextprotocol/server-filesystem', '.'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should handle invalid JSON gracefully by treating as comma-separated', () => {
    const input = '[invalid json';
    const expected: string[] = ['[invalid json'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should handle non-array JSON by treating as comma-separated', () => {
    const input = '{"key": "value"}';
    //Trim the curly braces
    const expected: string[] = ['"key": "value"'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });

  it('should convert array elements to strings', () => {
    const input = '[123, true, "string", null]';
    const expected = ['123', 'true', 'string', 'null'];
    const result = parseArgsToArray(input);
    expect(result).toEqual(expected);
  });
});

describe('arrayToArgsJson', () => {
  it('should convert array to JSON string', () => {
    const input = ['arg1', 'arg2', 'arg3'];
    const expected = '["arg1","arg2","arg3"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should convert array with special characters to JSON string', () => {
    const input = ['-y', '@modelcontextprotocol/server-sequential-thinking'];
    const expected = '["-y","@modelcontextprotocol/server-sequential-thinking"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should convert array with file paths containing backslashes', () => {
    const input = ['--directory', 'C:\\Users\\ASUS\\Desktop\\project', 'run', 'main.py'];
    const expected = '["--directory","C:\\\\Users\\\\ASUS\\\\Desktop\\\\project","run","main.py"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should convert array with file paths containing forward slashes', () => {
    const input = ['--directory', 'C:/Users/ASUS/Desktop/project', 'run', 'main.py'];
    const expected = '["--directory","C:/Users/ASUS/Desktop/project","run","main.py"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should handle empty array', () => {
    const input: string[] = [];
    const expected = '';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should filter out empty strings and whitespace-only strings', () => {
    const input = ['arg1', '', '  ', 'arg2'];
    const expected = '["arg1","arg2"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should return empty string for array with only empty/whitespace strings', () => {
    const input = ['', '  ', '\t', '\n'];
    const expected = '';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });

  it('should preserve strings with meaningful whitespace', () => {
    const input = ['arg with spaces', 'another arg'];
    const expected = '["arg with spaces","another arg"]';
    const result = arrayToArgsJson(input);
    expect(result).toBe(expected);
  });
});

describe('bidirectional conversion', () => {
  it('should correctly convert from comma-separated string to JSON and back', () => {
    const original = '-y,@modelcontextprotocol/server-filesystem,.';
    const array = parseArgsToArray(original);
    const jsonString = arrayToArgsJson(array);
    const finalArray = parseArgsToArray(jsonString);
    
    expect(array).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '.']);
    expect(jsonString).toBe('["-y","@modelcontextprotocol/server-filesystem","."]');
    expect(finalArray).toEqual(array);
  });

  it('should correctly convert from JSON string to array and back', () => {
    const original = '["-y","@modelcontextprotocol/server-sequential-thinking"]';
    const array = parseArgsToArray(original);
    const jsonString = arrayToArgsJson(array);
    
    expect(array).toEqual(['-y', '@modelcontextprotocol/server-sequential-thinking']);
    expect(jsonString).toBe(original);
  });

  it('should handle file paths with various slash types bidirectionally', () => {
    const windowsPath = '["--directory","C:\\\\Users\\\\ASUS\\\\Desktop\\\\project","run"]';
    const unixPath = '["--directory","/home/user/project","run"]';
    
    // Test Windows paths
    const windowsArray = parseArgsToArray(windowsPath);
    const windowsJson = arrayToArgsJson(windowsArray);
    expect(parseArgsToArray(windowsJson)).toEqual(windowsArray);
    
    // Test Unix paths
    const unixArray = parseArgsToArray(unixPath);
    const unixJson = arrayToArgsJson(unixArray);
    expect(parseArgsToArray(unixJson)).toEqual(unixArray);
  });

  it('should handle mixed path separators in comma-separated format', () => {
    const mixed = '--directory,C:/Users/ASUS\\Desktop/project,run,main.py';
    const array = parseArgsToArray(mixed);
    const jsonString = arrayToArgsJson(array);
    const finalArray = parseArgsToArray(jsonString);
    
    expect(array).toEqual(['--directory', 'C:/Users/ASUS\\Desktop/project', 'run', 'main.py']);
    expect(finalArray).toEqual(array);
  });
});
