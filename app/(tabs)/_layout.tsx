import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

const tabIcon = (name: React.ComponentProps<typeof Ionicons>['name']) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons color={color} name={name} size={size} />;
  };

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#C8F36A',
        tabBarInactiveTintColor: '#858D93',
        tabBarStyle: {
          backgroundColor: '#171A1D',
          borderTopColor: '#2C3135',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Keşfet',
          tabBarAccessibilityLabel: 'Keşfet sekmesi',
          tabBarIcon: tabIcon('compass-outline'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Hesap',
          tabBarAccessibilityLabel: 'Hesap sekmesi',
          tabBarIcon: tabIcon('person-outline'),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Bildirim',
          tabBarAccessibilityLabel: 'Bildirim sekmesi',
          tabBarIcon: tabIcon('notifications-outline'),
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: 'Hakkında',
          tabBarAccessibilityLabel: 'Hakkında sekmesi',
          tabBarIcon: tabIcon('information-circle-outline'),
        }}
      />
    </Tabs>
  );
}
