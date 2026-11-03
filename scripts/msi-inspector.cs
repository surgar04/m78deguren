using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace Zhenjing.Build
{
    // 仅调用 Windows Installer 的只读数据库接口，不运行任何安装或自定义动作。
    public static class MsiInspector
    {
        private const uint MoreData = 234;
        private const uint NoMoreItems = 259;

        [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint MsiOpenDatabaseW(string path, IntPtr mode, out uint database);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint MsiDatabaseOpenViewW(uint database, string query, out uint view);
        [DllImport("msi.dll", ExactSpelling = true)]
        private static extern uint MsiViewExecute(uint view, uint record);
        [DllImport("msi.dll", ExactSpelling = true)]
        private static extern uint MsiViewFetch(uint view, out uint record);
        [DllImport("msi.dll", ExactSpelling = true)]
        private static extern uint MsiViewClose(uint view);
        [DllImport("msi.dll", ExactSpelling = true)]
        private static extern uint MsiCloseHandle(uint handle);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint MsiRecordGetStringW(uint record, uint field, StringBuilder value, ref uint length);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint MsiGetSummaryInformationW(uint database, string path, uint updates, out uint summary);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint MsiSummaryInfoGetPropertyW(uint summary, uint property, out uint type,
            out int integer, out System.Runtime.InteropServices.ComTypes.FILETIME time, StringBuilder value, ref uint length);

        private static void Check(uint status)
        {
            if (status != 0) throw new Win32Exception((int)status);
        }

        private static string Field(uint record, uint index)
        {
            var text = new StringBuilder(256);
            uint length = (uint)text.Capacity;
            uint status = MsiRecordGetStringW(record, index, text, ref length);
            if (status == MoreData)
            {
                if (length > 1024 * 1024) throw new InvalidDataException("MSI field exceeds bound");
                text = new StringBuilder(checked((int)length + 1));
                length = (uint)text.Capacity;
                status = MsiRecordGetStringW(record, index, text, ref length);
            }
            Check(status);
            return text.ToString();
        }

        private static List<Dictionary<string, string[]>> Query(uint database, string sql, int columns)
        {
            uint view;
            Check(MsiDatabaseOpenViewW(database, sql, out view));
            try
            {
                Check(MsiViewExecute(view, 0));
                var rows = new List<Dictionary<string, string[]>>();
                for (;;)
                {
                    uint record;
                    uint status = MsiViewFetch(view, out record);
                    if (status == NoMoreItems) break;
                    Check(status);
                    try
                    {
                        if (rows.Count >= 100000) throw new InvalidDataException("MSI table exceeds row bound");
                        var cells = new string[columns];
                        for (int index = 0; index < columns; index++) cells[index] = Field(record, (uint)index + 1);
                        rows.Add(new Dictionary<string, string[]> { { "cells", cells } });
                    }
                    finally { MsiCloseHandle(record); }
                }
                return rows;
            }
            finally { MsiViewClose(view); MsiCloseHandle(view); }
        }

        private static string Template(uint database)
        {
            uint summary;
            Check(MsiGetSummaryInformationW(database, null, 0, out summary));
            try
            {
                var text = new StringBuilder(4096);
                uint length = (uint)text.Capacity, type;
                int integer;
                System.Runtime.InteropServices.ComTypes.FILETIME time;
                Check(MsiSummaryInfoGetPropertyW(summary, 7, out type, out integer, out time, text, ref length));
                return text.ToString();
            }
            finally { MsiCloseHandle(summary); }
        }

        // PID_WORDCOUNT 的 bit 3 表示“不需要提升权限”；这是包的实际标记，不能只检查 XML 文本。
        private static int WordCount(uint database)
        {
            uint summary;
            Check(MsiGetSummaryInformationW(database, null, 0, out summary));
            try
            {
                uint type, length = 0;
                int integer;
                System.Runtime.InteropServices.ComTypes.FILETIME time;
                Check(MsiSummaryInfoGetPropertyW(summary, 15, out type, out integer, out time, null, ref length));
                if (type != 3) throw new InvalidDataException("Invalid MSI privilege summary");
                return integer;
            }
            finally { MsiCloseHandle(summary); }
        }

        public static void ReadToFile(string input, string output)
        {
            uint database;
            // MSIDBOPEN_READONLY = 0；不能改成事务/创建模式。
            Check(MsiOpenDatabaseW(Path.GetFullPath(input), IntPtr.Zero, out database));
            try
            {
                var properties = new Dictionary<string, string>();
                foreach (var row in Query(database, "SELECT `Property`,`Value` FROM `Property`", 2))
                    properties.Add(row["cells"][0], row["cells"][1]);
                var data = new Dictionary<string, object> {
                    { "properties", properties },
                    { "files", Query(database, "SELECT `File`,`FileName`,`Version`,`Component_`,`FileSize` FROM `File`", 5) },
                    { "directories", Query(database, "SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`", 3) },
                    { "components", Query(database, "SELECT `Component`,`Directory_` FROM `Component`", 2) },
                    { "registry", Query(database, "SELECT `Root`,`Key`,`Name` FROM `Registry`", 3) },
                    { "template", Template(database) },
                    { "wordCount", WordCount(database) },
                    { "conditions", Query(database, "SELECT `Condition`,`Description` FROM `LaunchCondition`", 2) }
                };
                var serializer = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 32 };
                File.WriteAllText(Path.GetFullPath(output), serializer.Serialize(data), new UTF8Encoding(false));
            }
            finally { MsiCloseHandle(database); }
        }
    }
}
