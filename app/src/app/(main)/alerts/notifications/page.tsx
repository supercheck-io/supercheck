"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, AlertCircle, CheckCircle, Clock, Mail } from "lucide-react";
import { formatDistance } from "date-fns";

interface AlertNotification {
  id: string;
  type: 'failure' | 'recovery' | 'ssl_expiration';
  monitor: string;
  message: string;
  provider: string;
  status: 'sent' | 'failed' | 'pending';
  timestamp: string;
  duration?: number;
}

const mockNotifications: AlertNotification[] = [
  {
    id: "1",
    type: "failure",
    monitor: "Production API",
    message: "Monitor failed - HTTP 500 error",
    provider: "Email",
    status: "sent",
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "2",
    type: "recovery",
    monitor: "Production API",
    message: "Monitor recovered - HTTP 200 OK",
    provider: "Email",
    status: "sent",
    timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    duration: 20,
  },
];

export default function NotificationsPage() {
  const [notifications] = useState<AlertNotification[]>(mockNotifications);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filteredNotifications = notifications.filter(notification => {
    const matchesSearch = notification.monitor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         notification.message.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || notification.status === statusFilter;
    const matchesType = typeFilter === "all" || notification.type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'failure':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'recovery':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'ssl_expiration':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Mail className="h-4 w-4" />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'failure':
        return <Badge variant="destructive">Failure</Badge>;
      case 'recovery':
        return <Badge variant="secondary" className="bg-green-100 text-green-800">Recovery</Badge>;
      case 'ssl_expiration':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">SSL</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge variant="secondary" className="bg-green-100 text-green-800">Sent</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Alert Notifications</CardTitle>
          <CardDescription>
            View history of all alert notifications sent
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-6">
            <div className="flex space-x-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search notifications..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="failure">Failures</SelectItem>
                  <SelectItem value="recovery">Recoveries</SelectItem>
                  <SelectItem value="ssl_expiration">SSL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>

          {filteredNotifications.length === 0 ? (
            <div className="text-center py-8">
              <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No notifications found</h3>
              <p className="text-muted-foreground">
                {searchTerm || statusFilter !== "all" || typeFilter !== "all" 
                  ? "Try adjusting your filters" 
                  : "Alert notifications will appear here when monitors trigger alerts"
                }
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Monitor</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotifications.map((notification) => (
                  <TableRow key={notification.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getTypeIcon(notification.type)}
                        {getTypeBadge(notification.type)}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{notification.monitor}</TableCell>
                    <TableCell className="max-w-xs truncate">{notification.message}</TableCell>
                    <TableCell>{notification.provider}</TableCell>
                    <TableCell>{getStatusBadge(notification.status)}</TableCell>
                    <TableCell>
                      {formatDistance(new Date(notification.timestamp), new Date(), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {notification.duration ? `${notification.duration}m` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 